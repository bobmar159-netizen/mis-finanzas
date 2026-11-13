package com.misfinanzas.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "YarbiMediaLibrary")
public class YarbiMediaLibraryPlugin extends Plugin {
    private static final String PREFS = "yarbi_media_library";
    private static final String KEY_FOLDER_URI = "folder_uri";
    private static final int MAX_ITEMS = 500;

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderSelected");
    }

    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("No se seleccionó una carpeta");
            return;
        }
        try {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            prefs().edit().putString(KEY_FOLDER_URI, uri.toString()).apply();
            JSObject response = folderInfo(uri);
            response.put("selected", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("No se pudo conservar el acceso a la carpeta", error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        String raw = prefs().getString(KEY_FOLDER_URI, "");
        if (raw.isEmpty()) {
            JSObject response = new JSObject();
            response.put("selected", false);
            call.resolve(response);
            return;
        }
        JSObject response = folderInfo(Uri.parse(raw));
        response.put("selected", true);
        call.resolve(response);
    }

    @PluginMethod
    public void listMedia(PluginCall call) {
        String raw = prefs().getString(KEY_FOLDER_URI, "");
        if (raw.isEmpty()) {
            call.reject("Selecciona primero la carpeta Yarbi Multimedia");
            return;
        }
        try {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(raw));
            if (root == null || !root.exists() || !root.canRead()) {
                call.reject("La carpeta ya no está disponible");
                return;
            }
            JSArray items = new JSArray();
            collectMedia(root, items, 0);
            JSObject response = folderInfo(Uri.parse(raw));
            response.put("selected", true);
            response.put("items", items);
            response.put("count", items.length());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("No se pudo leer la biblioteca local", error);
        }
    }

    @PluginMethod
    public void preview(PluginCall call) {
        String raw = call.getString("uri", "");
        if (raw.isEmpty()) {
            call.reject("Falta el archivo");
            return;
        }
        Uri uri = Uri.parse(raw);
        String mime = getContext().getContentResolver().getType(uri);
        try {
            Bitmap bitmap = mime != null && mime.startsWith("video/") ? videoFrame(uri) : imagePreview(uri);
            if (bitmap == null) {
                call.reject("No se pudo generar la vista previa");
                return;
            }
            Bitmap scaled = scale(bitmap, 480);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 72, output);
            JSObject response = new JSObject();
            response.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
            if (scaled != bitmap) scaled.recycle();
            bitmap.recycle();
        } catch (Exception error) {
            call.reject("No se pudo generar la vista previa", error);
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String raw = call.getString("uri", "");
        if (raw.isEmpty()) {
            call.reject("Falta el archivo");
            return;
        }
        try {
            Uri uri = Uri.parse(raw);
            String mime = getContext().getContentResolver().getType(uri);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mime == null ? "application/octet-stream" : mime);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            String caption = call.getString("caption", "");
            if (!caption.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, caption);
            intent.setClipData(ClipData.newRawUri("Yarbi Multimedia", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            String preferredPackage = call.getString("packageName", "com.whatsapp.w4b");
            if (!preferredPackage.isEmpty()) intent.setPackage(preferredPackage);
            try {
                getContext().startActivity(intent);
            } catch (Exception missingPreferred) {
                intent.setPackage(null);
                getContext().startActivity(Intent.createChooser(intent, "Enviar con WhatsApp").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            JSObject response = new JSObject();
            response.put("opened", true);
            response.put("requiresUserConfirmation", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("No se pudo abrir WhatsApp para compartir", error);
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSObject folderInfo(Uri uri) {
        DocumentFile folder = DocumentFile.fromTreeUri(getContext(), uri);
        JSObject response = new JSObject();
        response.put("uri", uri.toString());
        response.put("name", folder != null && folder.getName() != null ? folder.getName() : "Yarbi Multimedia");
        return response;
    }

    private void collectMedia(DocumentFile folder, JSArray items, int depth) throws Exception {
        if (depth > 4 || items.length() >= MAX_ITEMS) return;
        for (DocumentFile file : folder.listFiles()) {
            if (items.length() >= MAX_ITEMS) break;
            if (file.isDirectory()) {
                collectMedia(file, items, depth + 1);
                continue;
            }
            String mime = file.getType();
            if (mime == null || (!mime.startsWith("image/") && !mime.startsWith("video/"))) continue;
            JSObject item = new JSObject();
            item.put("uri", file.getUri().toString());
            item.put("name", file.getName() == null ? "Archivo" : file.getName());
            item.put("mimeType", mime);
            item.put("kind", mime.startsWith("video/") ? "video" : "image");
            item.put("size", file.length());
            item.put("modifiedAt", file.lastModified());
            items.put(item);
        }
    }

    private Bitmap imagePreview(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            return BitmapFactory.decodeStream(input);
        }
    }

    private Bitmap videoFrame(Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            return retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }

    private Bitmap scale(Bitmap source, int maximum) {
        int width = source.getWidth();
        int height = source.getHeight();
        if (width <= maximum && height <= maximum) return source;
        float ratio = Math.min((float) maximum / width, (float) maximum / height);
        return Bitmap.createScaledBitmap(source, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);
    }
}
