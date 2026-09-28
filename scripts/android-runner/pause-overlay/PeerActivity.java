package dev.construct.test.pause;

/** Opaque, resizable peer for real Android multi-resume acceptance. No permissions or data access. */
public final class PeerActivity extends android.app.Activity {
    @Override public void onCreate(android.os.Bundle saved) {
        super.onCreate(saved);
        android.widget.Button close = new android.widget.Button(this);
        close.setAllCaps(false);
        close.setText("Close foreground test peer");
        close.setOnClickListener(v -> finish());
        setContentView(close);
    }
}
