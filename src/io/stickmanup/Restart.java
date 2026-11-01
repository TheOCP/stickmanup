package io.stickmanup;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

/**
 * Restart trampoline in its own process. The game process is killed (not shut down), so the GPU driver
 * never has to tear down WebGL objects, then a fresh game process is started.
 */
public class Restart extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int pid = getIntent().getIntExtra("pid", 0);
        if (pid != 0) Process.killProcess(pid);
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
        Process.killProcess(Process.myPid());
    }
}
