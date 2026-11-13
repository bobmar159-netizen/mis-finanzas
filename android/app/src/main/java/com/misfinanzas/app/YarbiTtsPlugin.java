package com.misfinanzas.app;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "YarbiTts")
public class YarbiTtsPlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private boolean ready = false;
    private String queuedText = "";

    @Override
    public void load() {
        super.load();
        textToSpeech = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready && textToSpeech != null) {
                int languageStatus = textToSpeech.setLanguage(new Locale("es", "PE"));
                if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
                    textToSpeech.setLanguage(new Locale("es", "ES"));
                }
                textToSpeech.setSpeechRate(0.96f);
                textToSpeech.setPitch(1.02f);
                if (!queuedText.isEmpty()) {
                    speakNow(queuedText);
                    queuedText = "";
                }
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("Texto vacio");
            return;
        }
        if (!ready || textToSpeech == null) {
            queuedText = text;
            call.resolve();
            return;
        }
        speakNow(text);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (textToSpeech != null) textToSpeech.stop();
        queuedText = "";
        call.resolve();
    }

    private void speakNow(String text) {
        if (textToSpeech != null) {
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "yarbi-response");
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        super.handleOnDestroy();
    }
}