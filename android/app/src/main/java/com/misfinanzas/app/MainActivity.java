package com.misfinanzas.app;

import android.content.Intent;
import android.os.Bundle;
import android.media.AudioManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.speechrecognition.SpeechRecognition;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GfcNotificationPlugin.class);
        registerPlugin(YarbiMediaLibraryPlugin.class);
        registerPlugin(YarbiTtsPlugin.class);
        registerPlugin(YarbiLiveServicePlugin.class);
        registerPlugin(YarbiAuthLinkPlugin.class);
        registerPlugin(SpeechRecognition.class);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        receiveAuthLink(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        receiveAuthLink(intent);
    }

    private void receiveAuthLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String url = intent.getData().toString();
        if (url.startsWith("com.misfinanzas.app://auth/callback")) {
            YarbiAuthLinkPlugin.receive(url);
        }
    }
}
