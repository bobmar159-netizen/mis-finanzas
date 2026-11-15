package com.misfinanzas.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "GfcNotificationPlugin",
    permissions = {
        @Permission(
            alias = "contacts",
            strings = { Manifest.permission.READ_CONTACTS }
        )
    }
)
public class GfcNotificationPlugin extends Plugin {

    private static final String TAG = "GfcNotificationPlugin";
    private static final String PREFS_NAME = "GfcNotificationPrefs";
    private static final String KEY_PENDING_LIST = "pending_notifications";
    private static final String KEY_LATEST_CLICKED = "latest_clicked_notification";

    @PluginMethod
    public void isPermissionGranted(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Context context = getContext();
            String enabledListeners = Settings.Secure.getString(
                    context.getContentResolver(),
                    "enabled_notification_listeners"
            );
            boolean isEnabled = enabledListeners != null && enabledListeners.contains(context.getPackageName());
            ret.put("granted", isEnabled);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error comprobando permisos", e);
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            Context context = getContext();
            Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error solicitando permisos", e);
            call.reject("No se pudo abrir la pantalla de configuración de notificaciones", e);
        }
    }

    @PluginMethod
    public void getPendingNotifications(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String listJson = prefs.getString(KEY_PENDING_LIST, "[]");
            // No se borra al leer. El WebView primero lo conserva en su outbox
            // local y solo después confirma los IDs persistidos. Así un cierre
            // de la app entre lectura y respaldo no pierde mensajes.
            ret.put("notificationsJson", listJson);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error obteniendo notificaciones pendientes", e);
            ret.put("notificationsJson", "[]");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void acknowledgePendingNotifications(PluginCall call) {
        try {
            JSArray requested = call.getArray("ids", new JSArray());
            Set<String> acknowledged = new HashSet<>();
            for (int i = 0; i < requested.length(); i++) {
                String id = requested.getString(i);
                if (id != null && id.matches("[A-Za-z0-9:_-]{8,160}")) acknowledged.add(id);
            }
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            org.json.JSONArray current = new org.json.JSONArray(prefs.getString(KEY_PENDING_LIST, "[]"));
            org.json.JSONArray remaining = new org.json.JSONArray();
            for (int i = 0; i < current.length(); i++) {
                org.json.JSONObject row = current.getJSONObject(i);
                String id = row.optString("id", "");
                if (!acknowledged.contains(id)) remaining.put(row);
            }
            prefs.edit().putString(KEY_PENDING_LIST, remaining.toString()).apply();
            JSObject ret = new JSObject();
            ret.put("acknowledged", acknowledged.size());
            ret.put("remaining", remaining.length());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "No se pudo confirmar notificaciones pendientes", e);
            call.reject("No se pudo confirmar notificaciones pendientes", e);
        }
    }

    @PluginMethod
    public void getPendingPayload(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = getActivity().getIntent();
            String payload = null;
            if (intent != null) {
                payload = intent.getStringExtra("whatsapp_payload");
            }

            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (payload == null) {
                payload = prefs.getString(KEY_LATEST_CLICKED, null);
            }

            // Limpiar el payload tras ser consumido
            if (payload != null) {
                if (intent != null) {
                    intent.removeExtra("whatsapp_payload");
                }
                prefs.edit().remove(KEY_LATEST_CLICKED).apply();
            }

            ret.put("payloadJson", payload);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error obteniendo payload pendiente", e);
            ret.put("payloadJson", null);
            call.resolve(ret);
        }
    }

    private String cleanNameForMatching(String s) {
        if (s == null) return "";
        String normalized = s.replaceAll("[\\s\\u00A0\\u2007\\u202F\\-\\(\\)]", "").toLowerCase().trim();
        normalized = java.text.Normalizer.normalize(normalized, java.text.Normalizer.Form.NFD);
        normalized = normalized.replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        return normalized;
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!(url.startsWith("https://") || url.startsWith("http://") || url.startsWith("geo:"))) {
            call.reject("El enlace no es seguro para abrir");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "No se pudo abrir enlace externo", e);
            call.reject("Android no pudo abrir el enlace", e);
        }
    }
    @PluginMethod
    public void getContactPhone(PluginCall call) {
        String name = call.getString("name");
        JSObject ret = new JSObject();
        
        if (name == null || name.isEmpty()) {
            ret.put("phone", "");
            call.resolve(ret);
            return;
        }

        // 1. Si name ya contiene un número de celular directo (contacto no guardado)
        java.util.regex.Matcher directMatcher = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(name.replaceAll("\\s+", ""));
        if (directMatcher.find()) {
            ret.put("phone", directMatcher.group(1));
            call.resolve(ret);
            return;
        }

        boolean hasSysPermission = androidx.core.content.ContextCompat.checkSelfPermission(
            getContext(), 
            Manifest.permission.READ_CONTACTS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED;

        if (!hasSysPermission) {
            Log.w(TAG, "getContactPhone: Permiso READ_CONTACTS no concedido a nivel de sistema");
            ret.put("phone", "");
            call.resolve(ret);
            return;
        }

        String phone = "";
        // Limpiar sufijos como "(Omar Personal)" o "(WhatsApp)"
        String sanitizedName = name.replaceAll("\\s*\\(.*?\\)", "").trim();
        if (sanitizedName.isEmpty()) sanitizedName = name.trim();

        String cleanTarget = cleanNameForMatching(sanitizedName);
        String firstWordTarget = cleanNameForMatching(sanitizedName.split("\\s+")[0]);

        Cursor cursor = null;
        try {
            ContentResolver cr = getContext().getContentResolver();
            cursor = cr.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ 
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, 
                    ContactsContract.CommonDataKinds.Phone.NUMBER 
                },
                null,
                null,
                null
            );
            
            if (cursor != null) {
                String exactMatchPhone = "";
                String partialMatchPhone = "";
                String firstWordMatchPhone = "";
                while (cursor.moveToNext()) {
                    String displayName = cursor.getString(0);
                    String phoneNumber = cursor.getString(1);
                    if (displayName != null && phoneNumber != null && !phoneNumber.isEmpty()) {
                        String cleanDisplay = cleanNameForMatching(displayName);
                        if (cleanDisplay.equals(cleanTarget)) {
                            exactMatchPhone = phoneNumber;
                            break;
                        } else if (cleanTarget.contains(cleanDisplay) || cleanDisplay.contains(cleanTarget)) {
                            if (partialMatchPhone.isEmpty()) partialMatchPhone = phoneNumber;
                        } else if (!firstWordTarget.isEmpty() && firstWordTarget.length() >= 3 && cleanDisplay.contains(firstWordTarget)) {
                            if (firstWordMatchPhone.isEmpty()) firstWordMatchPhone = phoneNumber;
                        }
                    }
                }
                phone = !exactMatchPhone.isEmpty() ? exactMatchPhone : (!partialMatchPhone.isEmpty() ? partialMatchPhone : firstWordMatchPhone);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error consultando contactos del sistema", e);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        if (phone != null && !phone.isEmpty()) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(phone.replaceAll("\\s+", ""));
            if (m.find()) {
                phone = m.group(1);
            }
        }

        ret.put("phone", phone != null ? phone : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void findContactsByName(PluginCall call) {
        String requested = call.getString("name", "").trim();
        JSObject ret = new JSObject();
        JSArray exact = new JSArray();
        JSArray partial = new JSArray();
        JSArray firstWord = new JSArray();
        if (requested.isEmpty() || !hasContactsPermission()) {
            ret.put("matches", new JSArray());
            ret.put("permission", hasContactsPermission());
            call.resolve(ret);
            return;
        }

        String sanitized = requested.replaceAll("^@+", "").replaceAll("\\s*\\(.*?\\)", "").trim();
        String cleanTarget = cleanNameForMatching(sanitized);
        String firstTarget = cleanNameForMatching(sanitized.split("\\s+")[0]);
        Set<String> seen = new HashSet<>();
        Set<String> seenNames = new HashSet<>();
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER },
                null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );
            while (cursor != null && cursor.moveToNext()) {
                String displayName = cursor.getString(0);
                String rawPhone = cursor.getString(1);
                String phone = normalizePeruPhone(rawPhone);
                if (displayName == null || phone.isEmpty() || !seen.add(phone)) continue;
                String cleanDisplay = cleanNameForMatching(displayName);
                String match = "";
                if (cleanDisplay.equals(cleanTarget)) match = "exact";
                else if (!cleanTarget.isEmpty() && (cleanTarget.contains(cleanDisplay) || cleanDisplay.contains(cleanTarget))) match = "partial";
                else if (firstTarget.length() >= 3 && cleanDisplay.contains(firstTarget)) match = "first_word";
                if (match.isEmpty()) { seen.remove(phone); continue; }
                JSObject item = new JSObject();
                item.put("name", displayName.trim());
                item.put("phone", phone);
                item.put("match", match);
                seenNames.add(cleanDisplay);
                if ("exact".equals(match)) exact.put(item);
                else if ("partial".equals(match)) partial.put(item);
                else firstWord.put(item);
            }
        } catch (Exception error) {
            Log.e(TAG, "Error buscando contactos por nombre", error);
        } finally {
            if (cursor != null) cursor.close();
        }

        // Algunos contactos creados desde WhatsApp conservan el nombre pero no
        // exponen un número al proveedor Phone. Aun así deben ser reconocibles
        // como identidad local, sin inventar un teléfono ni vincular un chat.
        Cursor nameCursor = null;
        try {
            nameCursor = getContext().getContentResolver().query(
                ContactsContract.Contacts.CONTENT_URI,
                new String[]{ ContactsContract.Contacts.DISPLAY_NAME },
                null, null, ContactsContract.Contacts.DISPLAY_NAME + " ASC"
            );
            while (nameCursor != null && nameCursor.moveToNext()) {
                String displayName = nameCursor.getString(0);
                if (displayName == null || displayName.trim().isEmpty()) continue;
                String cleanDisplay = cleanNameForMatching(displayName);
                if (cleanDisplay.isEmpty() || seenNames.contains(cleanDisplay)) continue;
                String match = "";
                if (cleanDisplay.equals(cleanTarget)) match = "exact_name_only";
                else if (!cleanTarget.isEmpty() && (cleanTarget.contains(cleanDisplay) || cleanDisplay.contains(cleanTarget))) match = "partial_name_only";
                else if (firstTarget.length() >= 3 && cleanDisplay.contains(firstTarget)) match = "first_word_name_only";
                if (match.isEmpty()) continue;
                seenNames.add(cleanDisplay);
                JSObject item = new JSObject();
                item.put("name", displayName.trim());
                item.put("phone", "");
                item.put("match", match);
                if (match.startsWith("exact")) exact.put(item);
                else if (match.startsWith("partial")) partial.put(item);
                else firstWord.put(item);
            }
        } catch (Exception error) {
            Log.e(TAG, "Error buscando contactos sin teléfono por nombre", error);
        } finally {
            if (nameCursor != null) nameCursor.close();
        }
        JSArray matches = new JSArray();
        for (int index = 0; index < exact.length(); index++) matches.put(exact.opt(index));
        for (int index = 0; index < partial.length(); index++) matches.put(partial.opt(index));
        for (int index = 0; index < firstWord.length(); index++) matches.put(firstWord.opt(index));
        ret.put("matches", matches);
        ret.put("permission", true);
        call.resolve(ret);
    }

    // Índice local privado para Yarbi. No se envía a Supabase: solo permite
    // relacionar más rápido el alias que el Maestro guardó en Android con el
    // mismo teléfono que llegó desde WhatsApp Business.
    @PluginMethod
    public void getContactIdentityIndex(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray contacts = new JSArray();
        if (!hasContactsPermission()) {
            ret.put("contacts", contacts);
            ret.put("permission", false);
            call.resolve(ret);
            return;
        }
        Set<String> seen = new HashSet<>();
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER },
                null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );
            while (cursor != null && cursor.moveToNext() && contacts.length() < 3000) {
                String displayName = cursor.getString(0);
                String phone = normalizePeruPhone(cursor.getString(1));
                if (displayName == null || displayName.trim().isEmpty() || phone.isEmpty() || !seen.add(phone)) continue;
                JSObject item = new JSObject();
                item.put("name", displayName.trim());
                item.put("phone", phone);
                contacts.put(item);
            }
        } catch (Exception error) {
            Log.e(TAG, "Error creando índice privado de contactos", error);
        } finally {
            if (cursor != null) cursor.close();
        }
        ret.put("contacts", contacts);
        ret.put("permission", true);
        call.resolve(ret);
    }

    private boolean hasContactsPermission() {
        return androidx.core.content.ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.READ_CONTACTS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private String normalizePeruPhone(String value) {
        String digits = value == null ? "" : value.replaceAll("\\D", "");
        if (digits.startsWith("51") && digits.length() == 11) digits = digits.substring(2);
        return digits;
    }

    @PluginMethod
    public void getContactName(PluginCall call) {
        JSObject ret = new JSObject();
        String phone = normalizePeruPhone(call.getString("phone", ""));
        if (phone.isEmpty() || !hasContactsPermission()) {
            ret.put("name", "");
            ret.put("source", "");
            call.resolve(ret);
            return;
        }
        Cursor cursor = null;
        try {
            Uri lookupUri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phone)
            );
            cursor = getContext().getContentResolver().query(
                lookupUri,
                new String[]{ ContactsContract.PhoneLookup.DISPLAY_NAME },
                null,
                null,
                null
            );
            String name = "";
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            ret.put("name", name == null ? "" : name.trim());
            ret.put("source", name == null || name.trim().isEmpty() ? "" : "android_phonebook");
            call.resolve(ret);
        } catch (Exception error) {
            Log.e(TAG, "Error buscando nombre por teléfono", error);
            ret.put("name", "");
            ret.put("source", "");
            call.resolve(ret);
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private String safeBackupFileName(String requested) {
        String value = requested == null ? "" : requested.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!value.toLowerCase().endsWith(".json")) value += ".json";
        if (value.length() < 6) value = "MisFinanzas_backup.json";
        return value;
    }

    @PluginMethod
    public void saveBackup(PluginCall call) {
        final String fileName = safeBackupFileName(call.getString("fileName", ""));
        final String content = call.getString("content", "");
        if (content.isEmpty()) {
            call.reject("La copia está vacía");
            return;
        }
        getBridge().executeOnMainThread(() -> {
            Uri uri = null;
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                String displayPath = "Descargas/MisFinanzas/" + fileName;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MisFinanzas");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    ContentResolver resolver = getContext().getContentResolver();
                    uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IllegalStateException("Android no creó el archivo");
                    try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                        if (output == null) throw new IllegalStateException("Android no abrió el archivo");
                        output.write(bytes);
                        output.flush();
                    }
                    ContentValues ready = new ContentValues();
                    ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(uri, ready, null, null);
                } else {
                    File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File folder = new File(downloads, "MisFinanzas");
                    if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("No se creó la carpeta MisFinanzas");
                    File target = new File(folder, fileName);
                    try (OutputStream output = new FileOutputStream(target, false)) {
                        output.write(bytes);
                        output.flush();
                    }
                    uri = Uri.fromFile(target);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("verified", true);
                ret.put("fileName", fileName);
                ret.put("displayPath", displayPath);
                ret.put("uri", uri == null ? "" : uri.toString());
                ret.put("bytes", bytes.length);
                call.resolve(ret);
            } catch (Exception error) {
                if (uri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
                }
                Log.e(TAG, "No se pudo guardar la copia", error);
                call.reject("No se pudo guardar en Descargas/MisFinanzas", error);
            }
        });
    }

    @PluginMethod
    public void requestContactsPermission(PluginCall call) {
        requestPermissionForAlias("contacts", call, "contactsCallback");
    }

    @PermissionCallback
    private void contactsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("contacts") == PermissionState.GRANTED);
        call.resolve(ret);
    }
}
