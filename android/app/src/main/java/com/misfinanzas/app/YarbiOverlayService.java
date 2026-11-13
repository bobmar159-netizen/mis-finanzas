package com.misfinanzas.app;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class YarbiOverlayService extends Service {

    public static final String ACTION_SET_STATE = "com.misfinanzas.app.YARBI_SET_STATE";
    public static final String EXTRA_STATE = "state";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_ROLE = "role";
    public static final String PREFS = "YarbiOverlayPrefs";
    public static final String KEY_OPEN_PANEL = "open_panel";
    public static final String KEY_ENABLED = "enabled";
    public static final String KEY_STOP_LIVE = "stop_live";

    private static final String CHANNEL_ID = "yarbi_mascot";
    private static final int NOTIFICATION_ID = 731;
    private static final String KEY_X = "x";
    private static final String KEY_Y = "y";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private FrameLayout overlayRoot;
    private ImageView mascot;
    private LinearLayout conversationBox;
    private TextView userBubble;
    private TextView yarbiBubble;
    private TextView trash;
    private WindowManager.LayoutParams overlayParams;
    private WindowManager.LayoutParams trashParams;
    private AnimatorSet mascotAnimator;
    private boolean dragging;
    private float downRawX;
    private float downRawY;
    private int downX;
    private int downY;
    private long downAt;
    private int overlayWidthPx;
    private int overlayHeightPx;
    private String currentState = "reposo";

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        overlayWidthPx = dp(286);
        overlayHeightPx = dp(318);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, true).apply();
        createOverlay();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String state = intent.getStringExtra(EXTRA_STATE);
            String message = intent.getStringExtra(EXTRA_MESSAGE);
            String role = intent.getStringExtra(EXTRA_ROLE);
            if (ACTION_SET_STATE.equals(intent.getAction()) || state != null || message != null) applyState(state, message, role);
        }
        return START_STICKY;
    }

    private void createOverlay() {
        overlayRoot = new FrameLayout(this);
        overlayRoot.setClipChildren(false);
        overlayRoot.setClipToPadding(false);

        conversationBox = new LinearLayout(this);
        conversationBox.setOrientation(LinearLayout.VERTICAL);
        conversationBox.setPadding(dp(4), dp(3), dp(4), dp(3));
        conversationBox.setVisibility(View.GONE);
        conversationBox.setClickable(false);
        conversationBox.setElevation(dp(10));
        FrameLayout.LayoutParams conversationLayout = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL
        );
        conversationLayout.leftMargin = dp(2);
        conversationLayout.rightMargin = dp(2);
        conversationLayout.topMargin = dp(2);
        overlayRoot.addView(conversationBox, conversationLayout);

        userBubble = createChatBubble(true, 2);
        LinearLayout.LayoutParams userLayout = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        userLayout.leftMargin = dp(42);
        userLayout.bottomMargin = dp(5);
        conversationBox.addView(userBubble, userLayout);

        yarbiBubble = createChatBubble(false, 3);
        LinearLayout.LayoutParams yarbiLayout = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        yarbiLayout.rightMargin = dp(42);
        conversationBox.addView(yarbiBubble, yarbiLayout);

        mascot = new ImageView(this);
        mascot.setImageResource(R.drawable.yarbi_idle);
        mascot.setScaleType(ImageView.ScaleType.FIT_CENTER);
        mascot.setContentDescription("Yarbi, asistente flotante");
        mascot.setElevation(dp(8));
        mascot.setOnTouchListener(this::handleMascotTouch);
        FrameLayout.LayoutParams mascotLayout = new FrameLayout.LayoutParams(dp(126), dp(126), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        mascotLayout.bottomMargin = dp(2);
        overlayRoot.addView(mascot, mascotLayout);

        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        int fallbackX = Math.max(0, screenWidth - overlayWidthPx - dp(8));
        int fallbackY = Math.max(dp(24), screenHeight - overlayHeightPx - dp(96));
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        overlayParams = new WindowManager.LayoutParams(
                overlayWidthPx, overlayHeightPx, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        overlayParams.gravity = Gravity.TOP | Gravity.START;
        overlayParams.x = clamp(prefs.getInt(KEY_X, fallbackX), 0, Math.max(0, screenWidth - overlayWidthPx));
        overlayParams.y = clamp(prefs.getInt(KEY_Y, fallbackY), dp(20), Math.max(dp(20), screenHeight - overlayHeightPx - dp(24)));
        try {
            windowManager.addView(overlayRoot, overlayParams);
            applyState(currentState, null, null);
        } catch (Exception error) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply();
            stopSelf();
        }
    }

    private boolean handleMascotTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downX = overlayParams.x;
                downY = overlayParams.y;
                downAt = SystemClock.uptimeMillis();
                dragging = false;
                view.animate().scaleX(1.04f).scaleY(1.04f).setDuration(120).start();
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                long heldMs = SystemClock.uptimeMillis() - downAt;
                if (!dragging && heldMs >= 180 && Math.hypot(dx, dy) > dp(5)) {
                    dragging = true;
                    stopMascotAnimation();
                    showTrash();
                }
                if (dragging) {
                    int screenWidth = getResources().getDisplayMetrics().widthPixels;
                    int screenHeight = getResources().getDisplayMetrics().heightPixels;
                    overlayParams.x = clamp((int) (downX + dx), 0, Math.max(0, screenWidth - overlayWidthPx));
                    overlayParams.y = clamp((int) (downY + dy), dp(8), Math.max(dp(8), screenHeight - overlayHeightPx));
                    safeUpdateOverlay();
                    updateTrashHighlight(event.getRawX(), event.getRawY());
                }
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                view.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                boolean wasDragging = dragging;
                boolean droppedOnTrash = wasDragging && isOverTrash(event.getRawX(), event.getRawY());
                hideTrash();
                dragging = false;
                if (droppedOnTrash) closeByUser();
                else if (wasDragging) {
                    savePositionAndSnap();
                    startMascotAnimation();
                } else if (SystemClock.uptimeMillis() - downAt < 520) openYarbiPanel();
                return true;
            default:
                return true;
        }
    }

    private void openYarbiPanel() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_OPEN_PANEL, true).putBoolean(KEY_ENABLED, false).apply();
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("openYarbi", true);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { startActivity(openIntent); } catch (Exception ignored) { }
        stopSelf();
    }

    private void closeByUser() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_OPEN_PANEL, false).putBoolean(KEY_ENABLED, false).putBoolean(KEY_STOP_LIVE, true).apply();
        try { stopService(new Intent(this, YarbiLiveForegroundService.class)); } catch (Exception ignored) { }
        stopSelf();
    }

    private void savePositionAndSnap() {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        boolean left = overlayParams.x + overlayWidthPx / 2 < width / 2;
        overlayParams.x = left ? -dp(34) : Math.max(-dp(34), width - overlayWidthPx + dp(34));
        overlayParams.y = clamp(overlayParams.y, dp(20), Math.max(dp(20), height - overlayHeightPx - dp(72)));
        safeUpdateOverlay();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(KEY_X, overlayParams.x).putInt(KEY_Y, overlayParams.y).apply();
    }

    private void safeUpdateOverlay() {
        if (windowManager == null || overlayRoot == null) return;
        try { windowManager.updateViewLayout(overlayRoot, overlayParams); } catch (Exception ignored) { }
    }

    private void showTrash() {
        if (trash != null) return;
        trash = new TextView(this);
        trash.setText("🗑\nSuelta para cerrar");
        trash.setTextColor(Color.WHITE);
        trash.setTextSize(12);
        trash.setGravity(Gravity.CENTER);
        trash.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        trash.setBackground(roundBackground(Color.rgb(177, 33, 52), dp(24)));
        trash.setElevation(dp(16));
        trashParams = new WindowManager.LayoutParams(dp(150), dp(78), overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT);
        trashParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        trashParams.y = dp(30);
        try { windowManager.addView(trash, trashParams); } catch (Exception ignored) { }
    }

    private void updateTrashHighlight(float rawX, float rawY) {
        if (trash == null) return;
        boolean over = isOverTrash(rawX, rawY);
        trash.setBackground(roundBackground(over ? Color.rgb(220, 38, 64) : Color.rgb(177, 33, 52), dp(24)));
        trash.setScaleX(over ? 1.12f : 1f);
        trash.setScaleY(over ? 1.12f : 1f);
    }

    private boolean isOverTrash(float rawX, float rawY) {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        return rawX >= (width - dp(174)) / 2f && rawX <= (width + dp(174)) / 2f && rawY >= height - dp(132) && rawY <= height - dp(18);
    }

    private void hideTrash() {
        if (trash == null || windowManager == null) return;
        try { windowManager.removeView(trash); } catch (Exception ignored) { }
        trash = null;
    }

    private void applyState(String state, String message, String role) {
        currentState = TextUtils.isEmpty(state) ? currentState : state.toLowerCase();
        if (mascot == null) return;
        mascot.setImageResource(imageForState(currentState));
        startMascotAnimation();
        if (!TextUtils.isEmpty(message) && ("user".equals(role) || "assistant".equals(role))) {
            showBubble(message, role);
        }
    }

    private int imageForState(String state) {
        if ("escuchando".equals(state) || "listening".equals(state)) return R.drawable.yarbi_listening;
        if ("procesando".equals(state) || "thinking".equals(state) || "buscando".equals(state) || "enviando".equals(state)) return R.drawable.yarbi_processing;
        if ("hablando".equals(state) || "speaking".equals(state) || "propuesta".equals(state) || "aprobacion".equals(state)) return R.drawable.yarbi_speaking;
        return R.drawable.yarbi_idle;
    }

    private void showBubble(String value, String role) {
        if (conversationBox == null) return;
        String clean = value.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
        if (clean.length() > 360) clean = clean.substring(0, 357) + "...";
        TextView target = "user".equals(role) ? userBubble : yarbiBubble;
        if (target == null) return;
        target.setText(("user".equals(role) ? "Tú: " : "Yarbi: ") + clean);
        target.setVisibility(View.VISIBLE);
        conversationBox.setVisibility(View.VISIBLE);
        conversationBox.setAlpha(0f);
        conversationBox.setTranslationY(dp(5));
        conversationBox.animate().alpha(1f).translationY(0f).setDuration(180).start();
    }

    private TextView createChatBubble(boolean user, int maxLines) {
        TextView view = new TextView(this);
        view.setTextColor(user ? Color.WHITE : Color.rgb(20, 45, 78));
        view.setTextSize(12.5f);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setGravity(user ? Gravity.END | Gravity.CENTER_VERTICAL : Gravity.START | Gravity.CENTER_VERTICAL);
        view.setMaxLines(maxLines);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setPadding(dp(11), dp(8), dp(11), dp(8));
        view.setBackground(chatBubbleBackground(user));
        view.setElevation(dp(7));
        view.setVisibility(View.GONE);
        view.setClickable(false);
        return view;
    }

    private void startMascotAnimation() {
        stopMascotAnimation();
        if (mascot == null) return;
        mascot.setRotation(0f);
        mascot.setScaleX(1f);
        mascot.setScaleY(1f);
        mascot.setTranslationY(0f);
        ObjectAnimator first;
        ObjectAnimator second;
        if ("escuchando".equals(currentState) || "listening".equals(currentState)) {
            first = ObjectAnimator.ofFloat(mascot, View.SCALE_X, 1f, 1.07f);
            second = ObjectAnimator.ofFloat(mascot, View.SCALE_Y, 1f, 1.07f);
            first.setDuration(620); second.setDuration(620);
        } else if ("procesando".equals(currentState) || "thinking".equals(currentState) || "buscando".equals(currentState) || "enviando".equals(currentState)) {
            first = ObjectAnimator.ofFloat(mascot, View.ROTATION, -2.5f, 2.5f);
            second = ObjectAnimator.ofFloat(mascot, View.TRANSLATION_Y, 0f, -dp(5));
            first.setDuration(700); second.setDuration(900);
        } else if ("hablando".equals(currentState) || "speaking".equals(currentState) || "propuesta".equals(currentState) || "aprobacion".equals(currentState)) {
            first = ObjectAnimator.ofFloat(mascot, View.TRANSLATION_Y, 0f, -dp(7));
            second = ObjectAnimator.ofFloat(mascot, View.SCALE_X, 1f, 1.04f);
            first.setDuration(520); second.setDuration(520);
        } else {
            first = ObjectAnimator.ofFloat(mascot, View.TRANSLATION_Y, 0f, -dp(5));
            second = ObjectAnimator.ofFloat(mascot, View.ROTATION, -1.2f, 1.2f);
            first.setDuration(1450); second.setDuration(1600);
        }
        first.setRepeatCount(ValueAnimator.INFINITE);
        first.setRepeatMode(ValueAnimator.REVERSE);
        second.setRepeatCount(ValueAnimator.INFINITE);
        second.setRepeatMode(ValueAnimator.REVERSE);
        first.setInterpolator(new AccelerateDecelerateInterpolator());
        second.setInterpolator(new AccelerateDecelerateInterpolator());
        mascotAnimator = new AnimatorSet();
        mascotAnimator.playTogether(first, second);
        mascotAnimator.start();
    }

    private void stopMascotAnimation() {
        if (mascotAnimator != null) {
            mascotAnimator.cancel();
            mascotAnimator = null;
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private GradientDrawable chatBubbleBackground(boolean user) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(user ? Color.rgb(29, 78, 216) : Color.argb(248, 240, 249, 255));
        drawable.setStroke(dp(2), user ? Color.rgb(96, 165, 250) : Color.rgb(14, 165, 233));
        drawable.setCornerRadius(dp(16));
        return drawable;
    }

    private GradientDrawable roundBackground(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("openYarbi", true);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Yarbi está contigo")
                .setContentText("Toca la mascota para abrir; mantenla presionada para moverla")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Mascota Yarbi", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantiene visible a Yarbi como asistente flotante");
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }

    @Override
    public void onDestroy() {
        stopMascotAnimation();
        hideTrash();
        if (overlayRoot != null && windowManager != null) {
            try { windowManager.removeView(overlayRoot); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
