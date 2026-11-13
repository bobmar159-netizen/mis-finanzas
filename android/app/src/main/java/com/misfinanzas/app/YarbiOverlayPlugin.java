package com.misfinanzas.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YarbiOverlay")
public class YarbiOverlayPlugin extends Plugin {

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(getContext());
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el permiso de superposicion", e);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(getContext())) {
            call.reject("Activa el permiso Mostrar sobre otras aplicaciones para Yarbi");
            return;
        }
        try {
            Context context = getContext();
            Intent intent = new Intent(context, YarbiOverlayService.class);
            intent.setAction(YarbiOverlayService.ACTION_SET_STATE);
            intent.putExtra(YarbiOverlayService.EXTRA_STATE, call.getString("state", "reposo"));
            intent.putExtra(YarbiOverlayService.EXTRA_MESSAGE, call.getString("message", ""));
            intent.putExtra(YarbiOverlayService.EXTRA_ROLE, call.getString("role", "assistant"));
            context.getSharedPreferences(YarbiOverlayService.PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(YarbiOverlayService.KEY_ENABLED, true)
                    .putBoolean(YarbiOverlayService.KEY_OPEN_PANEL, false)
                    .putBoolean(YarbiOverlayService.KEY_STOP_LIVE, false)
                    .apply();
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo iniciar la mascota flotante", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().getSharedPreferences(YarbiOverlayService.PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(YarbiOverlayService.KEY_ENABLED, false)
                    .putBoolean(YarbiOverlayService.KEY_OPEN_PANEL, false)
                    .apply();
            getContext().stopService(new Intent(getContext(), YarbiOverlayService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo cerrar la mascota flotante", e);
        }
    }

    @PluginMethod
    public void setState(PluginCall call) {
        String state = call.getString("state", "reposo");
        String message = call.getString("message", "");
        String role = call.getString("role", "status");
        Intent intent = new Intent(getContext(), YarbiOverlayService.class);
        intent.setAction(YarbiOverlayService.ACTION_SET_STATE);
        intent.putExtra(YarbiOverlayService.EXTRA_STATE, state);
        intent.putExtra(YarbiOverlayService.EXTRA_MESSAGE, message);
        intent.putExtra(YarbiOverlayService.EXTRA_ROLE, role);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void consumeOpenRequest(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(
                YarbiOverlayService.PREFS, Context.MODE_PRIVATE
        );
        boolean openPanel = prefs.getBoolean(YarbiOverlayService.KEY_OPEN_PANEL, false);
        boolean stopLive = prefs.getBoolean(YarbiOverlayService.KEY_STOP_LIVE, false);
        if (openPanel || stopLive) prefs.edit()
                .putBoolean(YarbiOverlayService.KEY_OPEN_PANEL, false)
                .putBoolean(YarbiOverlayService.KEY_STOP_LIVE, false)
                .apply();
        JSObject result = new JSObject();
        result.put("openPanel", openPanel);
        result.put("stopLive", stopLive);
        result.put("active", prefs.getBoolean(YarbiOverlayService.KEY_ENABLED, false));
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(
                YarbiOverlayService.PREFS, Context.MODE_PRIVATE
        );
        JSObject result = new JSObject();
        result.put("active", prefs.getBoolean(YarbiOverlayService.KEY_ENABLED, false));
        result.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext()));
        call.resolve(result);
    }
}
