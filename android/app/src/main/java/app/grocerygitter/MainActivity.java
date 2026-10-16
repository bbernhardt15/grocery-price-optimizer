package app.grocerygitter;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Edge-to-edge so viewport-fit=cover and the CSS safe-area padding line up
        // with the status bar and gesture bar. Must run before the bridge creates the WebView.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
