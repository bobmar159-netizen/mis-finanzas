package com.misfinanzas.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YarbiAuthLink")
public class YarbiAuthLinkPlugin extends Plugin {
    private static volatile String pendingUrl = "";
    private static volatile YarbiAuthLinkPlugin activeInstance;

    @Override
    public void load() {
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) activeInstance = null;
        super.handleOnDestroy();
    }

    public static void receive(String url) {
        if (url == null || url.trim().isEmpty()) return;
        pendingUrl = url;
        YarbiAuthLinkPlugin plugin = activeInstance;
        if (plugin != null) {
            JSObject data = new JSObject();
            data.put("url", url);
            plugin.notifyListeners("authLinkOpen", data, true);
        }
    }

    @PluginMethod
    public void getPendingUrl(PluginCall call) {
        JSObject result = new JSObject();
        String url = pendingUrl;
        pendingUrl = "";
        result.put("url", url);
        call.resolve(result);
    }
}
