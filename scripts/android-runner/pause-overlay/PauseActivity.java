package dev.construct.test.pause;

/** Disposable emulator-only lifecycle stimulus. No permissions, bridge or data access. */
public final class PauseActivity extends android.app.Activity {
    @Override public void onCreate(android.os.Bundle saved) {
        super.onCreate(saved);
        android.widget.Button close = new android.widget.Button(this);
        close.setText("Close lifecycle test overlay");
        close.setOnClickListener(v -> finish());
        android.widget.FrameLayout box = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams p = new android.widget.FrameLayout.LayoutParams(
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.Gravity.CENTER);
        box.addView(close, p);
        setContentView(box);
    }
}
