package com.misfinanzas.app;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YarbiLiveService")
public class YarbiLiveServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Context context = getContext();
            Intent intent = new Intent(context, YarbiLiveForegroundService.class);
            ContextCompat.startForegroundService(context, intent);
            JSObject result = new JSObject();
            result.put("active", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo mantener Yarbi Live activo en segundo plano", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), YarbiLiveForegroundService.class));
            JSObject result = new JSObject();
            result.put("active", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo detener el servicio de Yarbi Live", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", YarbiLiveForegroundService.isRunning());
        call.resolve(result);
    }
}
