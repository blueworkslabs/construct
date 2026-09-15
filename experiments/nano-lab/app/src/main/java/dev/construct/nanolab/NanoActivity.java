package dev.construct.nanolab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputFilter;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;

/** Standalone foreground-only probe. No Construct bridge, file access or cloud fallback. */
public final class NanoActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LabSession session = new LabSession();
    private final List<Button> presets = new ArrayList<>();
    private GenerativeModelFutures model;
    private ListenableFuture<?> pending;
    private Runnable timeout;
    private TextView status, metadata, output, timing;
    private EditText prompt;
    private Button check, download, send, stop;
    private int feature = -1;
    private String modelName = "Not queried", errorCode = "none", operation = "none";
    private long started, firstToken, elapsed, nextSendAt;
    private AlertDialog consent;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll = new ScrollView(this);
        scroll.setOnApplyWindowInsetsListener((view,insets)->{
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int)(16 * getResources().getDisplayMetrics().density);
        content.setPadding(padding,padding,padding,padding); scroll.addView(content); setContentView(scroll);
        label(content,"Construct Nano Lab",24);
        label(content,"Experimental text-only AICore probe. The developer switch alone does not guarantee Prompt API support.",16);
        label(content,"No cloud inference or app Internet permission. AICore may use networking to prepare/download its shared model. Nothing is saved; leaving this screen clears text.",14);
        status=label(content,"Not checked. Tap Check availability.",18);
        metadata=label(content,"Model: Not queried",14);
        check=button(content,"Check availability",v->checkAvailability());
        download=button(content,"Download model",v->confirmDownload());
        label(content,"Try a preset, or write a short prompt (2,000 characters maximum). Each request is independent, not a remembered conversation.",14);
        preset(content,"Tiny story","Write a playful story about a robot and a lost sock in exactly three short sentences.");
        preset(content,"Spaceship mechanic","You are a sarcastic but helpful spaceship mechanic. The coffee machine now produces bubbles. Give one funny diagnosis and one imaginary repair, in two short sentences.");
        preset(content,"Checklist","Turn these notes into a short checklist, adding no new tasks: pack the charger, water the plants, take the spare key.");
        prompt=new EditText(this); prompt.setHint("Your prompt"); prompt.setContentDescription("Your prompt");
        prompt.setMinLines(3); prompt.setMaxLines(6); prompt.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2000)});
        prompt.setSaveEnabled(false); prompt.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        content.addView(prompt);
        send=button(content,"Send prompt",v->generate());
        stop=button(content,"Stop request",v->cancel("Stopped. Check availability to reconnect. AICore may continue a model download independently."));
        button(content,"Clear text",v->{ if(session.isBusy()) cancel("Stopped and cleared. Check availability to reconnect."); clearText(); });
        timing=label(content,"No inference run yet.",14);
        output=label(content,"",18); output.setTextIsSelectable(true); output.setSaveEnabled(false);
        button(content,"Copy technical report",v->{
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Nano Lab technical report",report()));
            android.widget.Toast.makeText(this,"Technical report copied; prompt and response excluded.",android.widget.Toast.LENGTH_SHORT).show();
        });
        button(content,"Close Nano Lab",v->finish());
        controls();
    }
    private TextView label(LinearLayout parent,String text,int size) {
        TextView view=new TextView(this); view.setText(text); view.setTextSize(size); view.setPadding(0,8,0,8); parent.addView(view); return view;
    }
    private Button button(LinearLayout parent,String text,View.OnClickListener action) {
        Button b=new Button(this); b.setText(text); b.setAllCaps(false); b.setOnClickListener(action); parent.addView(b); return b;
    }
    private void preset(LinearLayout parent,String text,String value) {
        presets.add(button(parent,text,v->prompt.setText(value)));
    }
    @Override protected void onStart() { super.onStart(); session.start(); controls(); }
    @Override protected void onStop() {
        session.stop(); release(); clearText(); feature=-1; modelName="Not queried";
        if(consent!=null) { consent.dismiss(); consent=null; }
        status.setText("Session cleared after leaving. Tap Check availability."); metadata.setText("Model: Not queried"); controls();
        super.onStop();
    }
    private void clearText() { prompt.setText(""); output.setText(""); }
    private void controls() {
        if(check==null)return;
        boolean idle=session.isActive()&&!session.isBusy();
        check.setEnabled(idle); download.setEnabled(idle&&feature==FeatureStatus.DOWNLOADABLE);
        send.setEnabled(idle&&feature==FeatureStatus.AVAILABLE); stop.setEnabled(session.isBusy());
        prompt.setEnabled(idle); for(Button b:presets)b.setEnabled(idle);
    }
    private void release() {
        if(timeout!=null)main.removeCallbacks(timeout); timeout=null;
        if(pending!=null)pending.cancel(true); pending=null;
        if(model!=null) { try { model.getGenerativeModel().close(); } catch(RuntimeException ignored) { } model=null; }
    }
    private void cancel(String message) {
        session.cancel(); release(); feature=-1; status.setText(message); controls();
    }
    private long begin(String name,long millis) {
        long token=session.begin(); operation=name; errorCode="none"; started=SystemClock.elapsedRealtime();
        controls();
        timeout=()->{ if(session.accepts(token)) { errorCode="TIMEOUT"; cancel("Timed out. Check availability and try again later."); } };
        main.postDelayed(timeout,millis);
        return token;
    }
    private void done(long token,String text) {
        if(!session.finish(token))return;
        if(timeout!=null)main.removeCallbacks(timeout); timeout=null; pending=null;
        elapsed=SystemClock.elapsedRealtime()-started; status.setText(text); controls();
    }
    private void ensureModel() { if(model==null)model=GenerativeModelFutures.from(Generation.INSTANCE.getClient()); }
    private interface Result<T> { void accept(T result) throws Exception; }
    private <T> void watch(long token,ListenableFuture<T> future,Result<T> result) {
        if(!session.accepts(token)) { future.cancel(true); return; }
        pending=future;
        future.addListener(()->{
            if(!session.accepts(token))return;
            try { result.accept(future.get()); }
            catch(Exception | LinkageError e) { failure(token,e); }
        },command->main.post(command));
    }
    private void failure(long token,Throwable error) {
        if(!session.accepts(token))return;
        while(error instanceof ExecutionException && error.getCause()!=null)error=error.getCause();
        feature=-1;
        errorCode=error instanceof GenAiException ? "GENAI_"+((GenAiException)error).getErrorCode() : error instanceof CancellationException ? "CANCELLED" : "CLIENT_ERROR";
        String advice="Check availability again later. Device support, AICore setup or system updates may be required.";
        if(error instanceof GenAiException) {
            int code=((GenAiException)error).getErrorCode();
            if(code==GenAiException.ErrorCode.BUSY || code==GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED) advice="AICore is busy or its usage quota is reached. Wait and try again later.";
            else if(code==GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED) advice="Keep Nano Lab visible while running a request.";
            else if(code==GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE) advice="AICore needs more free storage before it can prepare the model.";
        }
        done(token,"Request failed ["+errorCode+"]. "+advice);
        release();
    }
    private void checkAvailability() {
        if(!session.isActive()||session.isBusy())return;
        feature=-1; modelName="Not queried"; metadata.setText("Model: Not queried");
        long token=begin("check",30000); status.setText("Checking Prompt API availability…");
        try {
            ensureModel(); watch(token,model.checkStatus(),value->{
                feature=value;
                if(value==FeatureStatus.AVAILABLE) {
                    readOptionalModelName(token);
                } else if(value==FeatureStatus.DOWNLOADABLE) done(token,"DOWNLOADABLE — AICore offers a model download. Nothing downloaded by this check.");
                else if(value==FeatureStatus.DOWNLOADING) done(token,"DOWNLOADING — AICore is preparing the model. Check again later.");
                else done(token,"UNAVAILABLE — Prompt API is not available to this app. The developer switch does not override device/API eligibility. If just enabled, allow AICore to finish setup and check again later.");
            });
        } catch(RuntimeException | LinkageError e) { failure(token,e); }
    }
    private void readOptionalModelName(long token) {
        // Metadata is useful for the experiment, but must not veto AVAILABLE.
        try {
            ListenableFuture<String> nameFuture=model.getBaseModelName(); pending=nameFuture;
            nameFuture.addListener(()->{
                if(!session.accepts(token))return;
                try { String name=nameFuture.get(); modelName=name==null?"Unknown":name.substring(0,Math.min(120,name.length())); }
                catch(Exception | LinkageError ignored) { modelName="Unavailable (optional metadata)"; }
                metadata.setText("Model: "+modelName); done(token,"AVAILABLE — ready for a short prompt.");
            },command->main.post(command));
            // Do not hold a usable model hostage to a slow optional metadata call.
            main.removeCallbacks(timeout);
            timeout=()->{ if(session.accepts(token)) { nameFuture.cancel(true); modelName="Unavailable (metadata timed out)"; metadata.setText("Model: "+modelName); done(token,"AVAILABLE — ready for a short prompt."); } };
            main.postDelayed(timeout,5000);
        } catch(RuntimeException | LinkageError ignored) {
            modelName="Unavailable (optional metadata)"; metadata.setText("Model: "+modelName); done(token,"AVAILABLE — ready for a short prompt.");
        }
    }
    private void confirmDownload() {
        if(session.isBusy()||feature!=FeatureStatus.DOWNLOADABLE)return;
        consent=new AlertDialog.Builder(this).setTitle("Download shared model?")
            .setMessage("AICore will manage the download, which may be large and use network data and storage. Wi-Fi is recommended. It may continue after this app closes. No prompt will run automatically.")
            .setNegativeButton("Cancel",null).setPositiveButton("Download",(dialog,which)->startDownload()).create(); consent.show();
    }
    private void startDownload() {
        if(!session.isActive()||session.isBusy()||feature!=FeatureStatus.DOWNLOADABLE)return;
        long token=begin("download",600000); status.setText("Requesting AICore model download…");
        try {
            ensureModel(); watch(token,model.download(new DownloadCallback() {
                @Override public void onDownloadProgress(long bytes) { main.post(()->{if(session.accepts(token))status.setText("Downloading via AICore: "+Math.max(0,bytes/1048576)+" MiB received.");}); }
            }),unused->{ feature=-1; done(token,"Download completed. Tap Check availability to verify readiness."); });
        } catch(RuntimeException | LinkageError e) { failure(token,e); }
    }
    private void generate() {
        if(!session.isActive()||session.isBusy()||feature!=FeatureStatus.AVAILABLE)return;
        String text=prompt.getText().toString().trim();
        if(text.isEmpty()) { status.setText("Enter a short prompt first."); return; }
        if(SystemClock.elapsedRealtime()<nextSendAt) { status.setText("Please wait two seconds between prompts."); return; }
        nextSendAt=SystemClock.elapsedRealtime()+2000;
        long token=begin("generate",120000); firstToken=0; output.setText(""); timing.setText("Waiting for first text…"); status.setText("Checking readiness for this prompt…");
        try {
            ensureModel(); GenerateContentRequest.Builder builder=new GenerateContentRequest.Builder(new TextPart(text));
            builder.setMaxOutputTokens(128); builder.setTemperature(0.4f); builder.setCandidateCount(1);
            GenerateContentRequest request=builder.build();
            watch(token,model.checkStatus(),value->{
                feature=value;
                if(value!=FeatureStatus.AVAILABLE) { done(token,"Model is no longer ready. Tap Check availability."); return; }
                watch(token,model.countTokens(request),count->{
                    if(count.getTotalTokens()>=4000) { done(token,"Prompt is too long for this experiment. Shorten it and retry."); return; }
                    status.setText("Generating locally through AICore…"); StringBuilder buffer=new StringBuilder();
                    watch(token,model.generateContent(request,chunk->main.post(()->{
                        if(!session.accepts(token))return;
                        if(firstToken==0)firstToken=SystemClock.elapsedRealtime()-started;
                        if(chunk!=null&&buffer.length()<8192)buffer.append(chunk,0,Math.min(chunk.length(),8192-buffer.length()));
                        output.setText(buffer.toString()); timing.setText("First text: "+firstToken+" ms · generating…");
                    })),response->{
                        if(!response.getCandidates().isEmpty()) { String valueText=response.getCandidates().get(0).getText(); if(valueText!=null)output.setText(valueText.substring(0,Math.min(8192,valueText.length()))); }
                        long total=SystemClock.elapsedRealtime()-started;
                        timing.setText("Input: "+count.getTotalTokens()+" tokens · First text: "+(firstToken==0?"not streamed":firstToken+" ms")+" · Total: "+total+" ms");
                        done(token,output.length()==0?"Completed without text. AICore may have filtered this response; try a simpler prompt.":"Complete — model output is experimental; check it before relying on it.");
                    });
                });
            });
        } catch(RuntimeException | LinkageError e) { failure(token,e); }
    }
    private String report() {
        String aicore="not visible";
        try { aicore=getPackageManager().getPackageInfo("com.google.android.aicore",0).versionName; } catch(android.content.pm.PackageManager.NameNotFoundException ignored) { }
        return "Construct Nano Lab "+BuildConfig.VERSION_NAME+"\nSDK: genai-prompt 1.0.0-beta4\nDevice: "+Build.MANUFACTURER+" "+Build.MODEL+"\nAndroid: "+Build.VERSION.RELEASE+" (API "+Build.VERSION.SDK_INT+")\nAICore: "+aicore+"\nModel: "+modelName+"\nFeature status: "+feature+"\nLast operation: "+operation+"\nLast error code: "+errorCode+"\nLast completed operation ms: "+elapsed+"\nPrompt/response text, identifiers and personal data are not included.";
    }
}
