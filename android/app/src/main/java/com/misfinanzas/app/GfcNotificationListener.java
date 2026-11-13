package com.misfinanzas.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

public class GfcNotificationListener extends NotificationListenerService {

    private static final String TAG = "GfcNotificationListener";
    private static final String PREFS_NAME = "GfcNotificationPrefs";
    private static final String KEY_PENDING_LIST = "pending_notifications";
    private static final String KEY_LATEST_CLICKED = "latest_clicked_notification";
    private static final String CHANNEL_ID = "citas_whatsapp_channel";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();
        if (packageName == null) return;

        // Escuchar únicamente de WhatsApp Business (com.whatsapp.w4b)
        boolean isWhatsAppBusiness = packageName.equals("com.whatsapp.w4b");
        if (!isWhatsAppBusiness) return;

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        // Usar getCharSequence para evitar que devuelva null si es un SpannableString
        CharSequence titleChar = extras.getCharSequence(Notification.EXTRA_TITLE); // Remitente/Grupo
        String title = titleChar != null ? titleChar.toString() : "";

        StringBuilder fullChatBuilder = new StringBuilder();

        // 1. Extraer mensajes completos de Notification.EXTRA_MESSAGES (MessagingStyle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && extras.containsKey(Notification.EXTRA_MESSAGES)) {
            android.os.Parcelable[] messages = (android.os.Parcelable[]) extras.get(Notification.EXTRA_MESSAGES);
            if (messages != null) {
                for (android.os.Parcelable p : messages) {
                    if (p instanceof Bundle) {
                        Bundle msgBundle = (Bundle) p;
                        CharSequence msgText = msgBundle.getCharSequence("text");
                        if (msgText != null && msgText.length() > 0) {
                            String str = msgText.toString().trim();
                            if (!str.isEmpty() && !fullChatBuilder.toString().contains(str)) {
                                if (fullChatBuilder.length() > 0) fullChatBuilder.append("\n");
                                fullChatBuilder.append(str);
                            }
                        }
                        if (msgBundle.containsKey("uri")) {
                            Object uObj = msgBundle.get("uri");
                            if (uObj != null) {
                                String uStr = uObj.toString();
                                if (!uStr.isEmpty() && !fullChatBuilder.toString().contains(uStr)) {
                                    if (fullChatBuilder.length() > 0) fullChatBuilder.append("\n");
                                    fullChatBuilder.append(uStr);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Extraer de Notification.EXTRA_TEXT_LINES (InboxStyle multi-mensaje)
        if (extras.containsKey(Notification.EXTRA_TEXT_LINES)) {
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null) {
                for (CharSequence line : lines) {
                    if (line != null && line.length() > 0) {
                        String str = line.toString().trim();
                        if (!str.isEmpty() && !fullChatBuilder.toString().contains(str)) {
                            if (fullChatBuilder.length() > 0) fullChatBuilder.append("\n");
                            fullChatBuilder.append(str);
                        }
                    }
                }
            }
        }

        // 3. Extraer de Notification.EXTRA_BIG_TEXT si existe
        CharSequence bigTextChar = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (bigTextChar != null && bigTextChar.length() > 0) {
            String bigStr = bigTextChar.toString().trim();
            if (!bigStr.isEmpty() && !fullChatBuilder.toString().contains(bigStr)) {
                if (fullChatBuilder.length() > 0) fullChatBuilder.append("\n");
                fullChatBuilder.append(bigStr);
            }
        }

        // 4. Extraer de Notification.EXTRA_TEXT
        CharSequence textChar = extras.getCharSequence(Notification.EXTRA_TEXT);
        if (textChar != null && textChar.length() > 0) {
            String textStr = textChar.toString().trim();
            if (!textStr.isEmpty() && !fullChatBuilder.toString().contains(textStr)) {
                if (fullChatBuilder.length() > 0) fullChatBuilder.append("\n");
                fullChatBuilder.append(textStr);
            }
        }

        String text = fullChatBuilder.toString().trim();

        if (title == null || title.isEmpty() || text.isEmpty()) return;

        // Omitir notificaciones del sistema de WhatsApp, reacciones, estados y copias de seguridad
        String lowerTitle = title.toLowerCase();
        String lowerText = text.toLowerCase();
        if (lowerText.contains("buscando nuevos mensajes") || 
            lowerText.contains("comprobando si hay mensajes nuevos") ||
            lowerText.contains("whatsapp web") ||
            lowerText.contains("respaldo de chats") ||
            lowerText.contains("copia de seguridad") ||
            lowerText.contains("guardando copia") ||
            lowerText.contains("restaurando") ||
            lowerText.contains("le dio me gusta") ||
            lowerText.contains("reaccionó") ||
            lowerText.contains("reaccionó a") ||
            lowerText.contains("reaccionó con") ||
            lowerText.contains("estado") ||
            lowerTitle.contains("whatsapp") ||
            lowerTitle.contains("wa business") ||
            lowerTitle.contains("documentos y fotos") ||
            lowerTitle.contains("copia de seguridad") ||
            lowerTitle.contains("estado") ||
            lowerTitle.contains("meta business") ||
            lowerTitle.contains("meta business agent") ||
            lowerTitle.contains("meta") ||
            lowerTitle.contains("facebook")) {
            return;
        }

        // Limpiar frases como "2 mensajes nuevos" o "3 mensajes" del texto del cuerpo
        text = text.replaceAll("(?i)\\b\\d+\\s*mensajes\\s*(nuevos)?\\b", "").replaceAll("\n+", "\n").trim();
        if (text.isEmpty()) return;

        Log.d(TAG, "Notificación capturada: " + title + " -> " + text);

        try {
            // Crear el objeto de datos
            JSONObject item = new JSONObject();
            String id = UUID.randomUUID().toString();
            item.put("id", id);
            item.put("appName", packageName.equals("com.whatsapp.w4b") ? "WhatsApp Business" : "WhatsApp");
            item.put("title", title);
            item.put("text", text);
            item.put("phone", extractPhoneNumberFromNotification(sbn, notification, extras, text, title));
            item.put("timestamp", System.currentTimeMillis());

            // 1. Guardar en la cola acumulada de SharedPreferences
            saveToSharedPreferences(item);

            // 2. Disparar una notificación nativa del sistema
            showSystemNotification(id, title, text, item.toString());

        } catch (Exception e) {
            Log.e(TAG, "Error procesando notificación", e);
        }
    }

    private void saveToSharedPreferences(JSONObject newItem) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String existingJson = prefs.getString(KEY_PENDING_LIST, "[]");
            JSONArray array = new JSONArray(existingJson);
            
            JSONArray tempArray = new JSONArray();
            boolean updated = false;
            String newTitle = newItem.getString("title");
            String newText = newItem.getString("text");
            JSONObject matchedItem = null;
            
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                if (newTitle.equals(obj.getString("title"))) {
                    matchedItem = obj;
                    String oldText = obj.getString("text");
                    // Evitar duplicar exactamente el mismo mensaje en el historial del chat
                    if (!oldText.contains(newText)) {
                        obj.put("text", oldText + "\n" + newText);
                    }
                    obj.put("timestamp", newItem.getLong("timestamp"));
                    updated = true;
                } else {
                    tempArray.put(obj);
                }
            }
            
            JSONArray finalArray = new JSONArray();
            if (updated && matchedItem != null) {
                finalArray.put(matchedItem);
            } else {
                finalArray.put(newItem);
            }
            
            for (int i = 0; i < tempArray.length(); i++) {
                finalArray.put(tempArray.getJSONObject(i));
            }
            
            prefs.edit().putString(KEY_PENDING_LIST, finalArray.toString()).apply();
            Log.d(TAG, "Guardado acumulativo en SharedPreferences: " + finalArray.toString());
        } catch (Exception e) {
            Log.e(TAG, "Error guardando acumulativo en SharedPreferences", e);
        }
    }

    private void showSystemNotification(String id, String title, String text, String payloadJson) {
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) return;

        // Crear canal de notificación para Android Oreo o superior
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Citas de WhatsApp Business",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notificaciones para agendar citas directamente desde WhatsApp.");
            channel.enableLights(true);
            channel.enableVibration(true);
            notificationManager.createNotificationChannel(channel);
        }

        // Configurar el Intent que se activará al hacer click en la notificación
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("whatsapp_payload", payloadJson);

        // Guardar también en SharedPreferences cuál fue la última notificación que lanzamos
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(KEY_LATEST_CLICKED, payloadJson)
                .apply();

        // Flag de mutabilidad para Android 12 o superior
        int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                id.hashCode(),
                intent,
                pendingIntentFlags
        );

        // Construir la notificación nativa
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat) // Icono genérico de chat
                .setContentTitle("¿Agendar Cita en Mis Finanzas?")
                .setContentText(title + ": \"" + text + "\"")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(title + ": \"" + text + "\""))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setColor(0xFF0F766E); // Color verde azulado de la app (#0F766E)

        // Usar un ID numérico único basado en el hash del remitente para agrupar mensajes de la misma persona
        int notificationId = title.hashCode();
        notificationManager.notify(notificationId, builder.build());
    }

    private String extractPhoneNumberFromNotification(StatusBarNotification sbn, Notification notification, Bundle extras, String text, String title) {
        // 0. Extraer de sbn.getKey(), sbn.getTag() o notification.shortcutId (Formato de WhatsApp JID: 519XXXXXXXX@s.whatsapp.net)
        try {
            if (sbn != null) {
                String key = sbn.getKey();
                if (key != null) {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(key);
                    if (m.find()) return m.group(1);
                }
                String tag = sbn.getTag();
                if (tag != null) {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(tag);
                    if (m.find()) return m.group(1);
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && notification != null) {
                String shortcutId = notification.getShortcutId();
                if (shortcutId != null) {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(shortcutId);
                    if (m.find()) return m.group(1);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error extrayendo teléfono de sbn key/tag", e);
        }

        // 1. Si el título ya contiene un número de celular directo (contacto nuevo no guardado)
        if (title != null && !title.isEmpty()) {
            java.util.regex.Matcher mTitle = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(title.replaceAll("\\s+", ""));
            if (mTitle.find()) {
                return mTitle.group(1);
            }
        }

        // 2. Extraer de extras de la notificación de Android (android.people.list)
        if (extras != null) {
            try {
                if (extras.containsKey("android.people.list")) {
                    Object peopleObj = extras.get("android.people.list");
                    if (peopleObj != null) {
                        String str = peopleObj.toString();
                        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(str.replaceAll("\\s+", ""));
                        if (m.find()) {
                            return m.group(1);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Error extrayendo teléfono de extras", e);
            }
        }

        // 3. Extraer del texto del mensaje (ej: "Mi número es 987654321")
        if (text != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(text.replaceAll("\\s+", ""));
            if (m.find()) {
                return m.group(1);
            }
        }

        // 4. Si es un contacto guardado con nombre (ej: "Kevin" o "Omar Personal"), buscar en la agenda de contactos de Android
        if (title != null && !title.isEmpty()) {
            String phoneFromContacts = lookupPhoneNumberFromContactsContract(title);
            if (phoneFromContacts != null && !phoneFromContacts.isEmpty()) {
                return phoneFromContacts;
            }
        }
        return "";
    }

    private String lookupPhoneNumberFromContactsContract(String contactName) {
        if (contactName == null || contactName.trim().isEmpty()) return "";
        try {
            // Limpiar etiquetas como "(Omar Personal)" o "(Trabajo)"
            String sanitized = contactName.replaceAll("\\s*\\(.*?\\)", "").trim();
            if (sanitized.isEmpty()) sanitized = contactName.trim();

            android.net.Uri uri = android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
            String selection = android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";
            String[] selectionArgs = new String[]{"%" + sanitized + "%"};
            android.database.Cursor cursor = getApplicationContext().getContentResolver().query(uri, new String[]{android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER}, selection, selectionArgs, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String num = cursor.getString(0);
                    if (num != null) {
                        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:\\+?51)?([9]\\d{8})").matcher(num.replaceAll("\\s+", ""));
                        if (m.find()) {
                            cursor.close();
                            return m.group(1);
                        }
                    }
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.w(TAG, "Error buscando teléfono en contactos", e);
        }
        return "";
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Opcional: limpiar recursos si es necesario
    }
}
