/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.app.AlertDialog$Builder
 *  android.content.ActivityNotFoundException
 *  android.content.DialogInterface$OnClickListener
 *  android.content.Intent
 *  android.net.Uri
 *  android.os.Build$VERSION
 *  android.os.Parcelable
 *  android.widget.Toast
 */
package com.corrodinggames.rts.appFramework;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.widget.Toast;
import com.corrodinggames.rts.appFramework.c$1;
import com.corrodinggames.rts.appFramework.c$2;
import com.corrodinggames.rts.appFramework.e;
import com.corrodinggames.rts.gameFramework.e.a;
import com.corrodinggames.rts.gameFramework.f;
import com.corrodinggames.rts.gameFramework.l;
import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class c {
    static Handler a;
    static volatile Context b;
    public static final e c;
    public static e d;

    public static int a(String string2) {
        Pattern pattern;
        Matcher matcher;
        String string3 = null;
        if (string2 != null) {
            string3 = f.k(string2);
        }
        if (string3 != null && (matcher = (pattern = Pattern.compile("^ *\\[([^\\]]*)\\].*")).matcher(string3)).matches()) {
            String[] stringArray;
            String string4 = matcher.group(1);
            for (String string5 : stringArray = string4.split(";")) {
                int n2;
                if (!string5.startsWith("p") || string5.length() < 2) continue;
                String string6 = string5.substring(1);
                try {
                    n2 = Integer.parseInt(string6);
                }
                catch (NumberFormatException numberFormatException) {
                    l.e("getNumberOfPlayersInMap: NumberFormatException:" + string6);
                    return -1;
                }
                return n2;
            }
        }
        l.e("getNumberOfPlayersInMap: fail to match:" + string3);
        return -1;
    }

    public static String b(String string2) {
        Pattern pattern;
        Matcher matcher;
        Object object;
        if (string2 == null) {
            return null;
        }
        if (string2.contains(File.separator)) {
            object = string2.split(Pattern.quote(File.separator));
            string2 = object[((String[])object).length - 1];
        }
        if (string2.contains("/")) {
            object = string2.split("/");
            string2 = object[((String[])object).length - 1];
        }
        if ((object = null) == null && (matcher = (pattern = Pattern.compile("^l\\d*;\\[.*\\](.+)\\.tmx")).matcher(string2)).matches() && ((String)(object = matcher.group(1))).length() >= 1) {
            object = ((String)object).substring(0, 1).toUpperCase() + ((String)object).substring(1);
        }
        if (object == null && (matcher = (pattern = Pattern.compile("^l\\d*;(.+)\\.tmx")).matcher(string2)).matches() && ((String)(object = matcher.group(1))).length() >= 1) {
            object = ((String)object).substring(0, 1).toUpperCase() + ((String)object).substring(1);
        }
        if (object == null && (matcher = (pattern = Pattern.compile("^ *\\[.*\\](.+)\\.tmx")).matcher(string2)).matches() && ((String)(object = matcher.group(1))).length() >= 1) {
            object = ((String)object).substring(0, 1).toUpperCase() + ((String)object).substring(1);
        }
        if (object == null && (matcher = (pattern = Pattern.compile("(.*)\\.tmx")).matcher(string2)).matches() && ((String)(object = matcher.group(1))).length() >= 1) {
            object = ((String)object).substring(0, 1).toUpperCase() + ((String)object).substring(1);
        }
        if (object == null) {
            object = string2;
        }
        if (((String)(object = ((String)object).replace('_', ' '))).endsWith(".rwsave")) {
            object = ((String)object).replace(".rwsave", "");
        }
        return object;
    }

    public static String c(String string2) {
        String string3 = string2.replace(".tmx", "");
        string3 = string3 + "_map.png";
        return string3;
    }

    private static void c(Activity activity) {
        if (Build.VERSION.SDK_INT >= 19) {
            activity.a().getDecorView().setSystemUiVisibility(5894);
        }
    }

    private static void d(Activity activity) {
    }

    public static void a(Runnable runnable) {
        if (a == null) {
            a = new Handler(Looper.b());
        }
        a.a(runnable);
    }

    public static Context a() {
        if (b == null) {
            throw new RuntimeException("ApplicationContext==null");
        }
        return b;
    }

    public static void a(Activity activity) {
        if (b == null) {
            b = activity.g();
        }
    }

    public static void a(Context context) {
        if (b == null) {
            b = context.g();
        }
    }

    public static void a(Activity activity, boolean bl2, boolean bl3) {
        l l2;
        com.corrodinggames.rts.appFramework.c.a(activity);
        if (bl3) {
            l2 = l.B();
            if (l2 != null && l2.bQ.immersiveFullScreen) {
                com.corrodinggames.rts.appFramework.c.c(activity);
            }
        } else {
            com.corrodinggames.rts.appFramework.c.d(activity);
        }
        l2 = l.B();
        if (l2 != null) {
            l2.ab();
        }
        if (bl2) {
            activity.a().setBackgroundDrawable(null);
        }
    }

    public static void a(Activity activity, boolean bl2) {
        if (bl2) {
            activity.a(0, 0);
        }
    }

    public static boolean a(Activity activity, Runnable runnable) {
        l l2 = l.B();
        boolean bl2 = com.corrodinggames.rts.appFramework.c.a(activity, runnable, false);
        return bl2;
    }

    public static boolean a(Activity activity, Runnable runnable, boolean bl2) {
        l l2 = l.B();
        if (bl2 || !l2.bQ.hasSelectedAStorageType) {
            if (Build.VERSION.SDK_INT < 19) {
                return false;
            }
            c$1 c$1 = new c$1(l2, runnable);
            c$2 c$2 = new c$2(activity, l2, runnable);
            String string2 = com.corrodinggames.rts.gameFramework.h.a.a("menus.mods.androidStorageSetupTitle", new Object[0]);
            String string3 = com.corrodinggames.rts.gameFramework.h.a.a("menus.mods.androidStorageSetupMessage", new Object[0]);
            String string4 = com.corrodinggames.rts.gameFramework.h.a.a("menus.mods.androidStorageSetupInternal", new Object[0]);
            String string5 = com.corrodinggames.rts.gameFramework.h.a.a("menus.mods.androidStorageSetupExternal", new Object[0]);
            new AlertDialog.Builder((Context)activity).setIcon(17301543).setTitle((CharSequence)string2).setMessage((CharSequence)string3).setPositiveButton((CharSequence)string4, (DialogInterface.OnClickListener)c$1).setNeutralButton((CharSequence)string5, (DialogInterface.OnClickListener)c$2).show();
            l.e("Showing storage setup");
            return true;
        }
        return false;
    }

    public static boolean b(Context context) {
        if (l.aU) {
            return true;
        }
        if (!com.corrodinggames.rts.gameFramework.e.a.f()) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= 23) {
            return ContextCompat.a(context, "android.permission.WRITE_EXTERNAL_STORAGE") == 0;
        }
        return true;
    }

    public static boolean b(Activity activity) {
        l l2 = l.B();
        if (l.aU) {
            return true;
        }
        if (!com.corrodinggames.rts.gameFramework.e.a.f()) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= 23) {
            if (l2.aD() == null) {
                // empty if block
            }
            if (ContextCompat.a(activity, "android.permission.WRITE_EXTERNAL_STORAGE") == 0) {
                l2.bQ.hadStoragePermissionInPast = true;
                l.e("File Permission is granted");
                return true;
            }
            l.e("Permission is revoked");
            ActivityCompat.a(activity, new String[]{"android.permission.WRITE_EXTERNAL_STORAGE"}, 1);
            return false;
        }
        return true;
    }

    public static void a(Intent intent) {
        intent.addFlags(65536);
    }

    public static void a(Activity activity, int n2, boolean bl2, String string2, Uri uri) {
        l.e("Show folder chooser. Write:" + bl2);
        Intent intent = new Intent("android.intent.action.OPEN_DOCUMENT_TREE");
        intent.addFlags(64);
        intent.addFlags(1);
        if (bl2) {
            intent.addFlags(2);
        }
        if (uri != null) {
            intent.putExtra("android.provider.extra.INITIAL_URI", (Parcelable)uri);
        }
        intent.putExtra("android.content.extra.SHOW_ADVANCED", true);
        try {
            activity.a(Intent.createChooser((Intent)intent, (CharSequence)string2), n2);
        }
        catch (ActivityNotFoundException activityNotFoundException) {
            Toast.makeText((Context)activity, (CharSequence)"Failed to open file list. Please install a File Manager.", (int)0).show();
        }
    }

    static {
        d = c = e.f;
    }
}

