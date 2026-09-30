/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.a;

import com.corrodinggames.librocket.scripts.ScriptEngine;
import com.corrodinggames.librocket.scripts.ScriptEngine$Action;
import com.corrodinggames.rts.a.a$1;
import com.corrodinggames.rts.a.a$2;
import com.corrodinggames.rts.a.b;
import com.corrodinggames.rts.gameFramework.l;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Locale;

public strictfp class a
implements Runnable {
    public ServerSocket a;
    public boolean b = true;
    public static boolean c = false;
    public static boolean d = false;
    static ArrayList e = new ArrayList();

    public static boolean a() {
        return c;
    }

    public static void a(String string2) {
        c = true;
        e.add(string2);
    }

    public static void b() {
        if (e.size() == 0) {
            return;
        }
        a$1 a$1 = new a$1();
        Thread thread = new Thread(a$1);
        thread.start();
    }

    public static void a(int n2, String string2) {
        try {
            c = true;
            l.aT = true;
            a a2 = new a();
            if (n2 != -1) {
                a2.a = new ServerSocket(n2);
                Thread thread = new Thread(a2);
                thread.start();
            }
        }
        catch (IOException iOException) {
            throw new RuntimeException(iOException);
        }
    }

    private a() {
    }

    /*
     * Enabled force condition propagation
     * Lifted jumps to return sites
     */
    @Override
    public void run() {
        try {
            while (this.b) {
                Socket socket = this.a.accept();
                try {
                    socket.setTcpNoDelay(true);
                    b b2 = new b(this, socket);
                    Thread thread = new Thread(b2);
                    thread.run();
                }
                catch (IOException iOException) {
                    l.e("Got IOException on debugSocket connection");
                    iOException.printStackTrace();
                    throw new RuntimeException(iOException);
                    return;
                }
            }
        }
        catch (IOException iOException) {
            throw new RuntimeException(iOException);
        }
    }

    public static String b(String string2) {
        String string3 = null;
        String[] stringArray = null;
        int n2 = string2.indexOf(" ");
        if (n2 == -1) {
            n2 = string2.length();
        }
        String string4 = string2.substring(0, n2).toLowerCase(Locale.ENGLISH);
        if (n2 != -1 && string2.length() >= n2 + 1) {
            string3 = string2.substring(n2 + 1);
            stringArray = string3.split(" ");
        }
        if (ScriptEngine.getInstance() == null) {
            l.b("DebugSocketConnection: waiting for ScriptEngine to start....");
            for (int i2 = 0; i2 < 100; ++i2) {
                if (ScriptEngine.getInstance() != null) {
                    l.b("started");
                    break;
                }
                try {
                    Thread.sleep(100L);
                    continue;
                }
                catch (InterruptedException interruptedException) {
                    interruptedException.printStackTrace();
                }
            }
        }
        if (string4.equalsIgnoreCase("ping")) {
            return "pong";
        }
        if (string4.equalsIgnoreCase("crash")) {
            throw new RuntimeException("test crash");
        }
        if (string4.equalsIgnoreCase("script")) {
            boolean bl2;
            if (string3 == null) {
                return "argString==null";
            }
            ScriptEngine scriptEngine = ScriptEngine.getInstance();
            ScriptEngine$Action scriptEngine$Action = scriptEngine.addScriptToQueue(string3);
            String string5 = scriptEngine$Action.waitForCompletionOrCrash(bl2 = false);
            if (string5 == null) {
                return "done";
            }
            return string5;
        }
        if (string4.equalsIgnoreCase("function") || string4.equalsIgnoreCase("functionNoTimeout")) {
            String string6;
            if (string3 == null) {
                return "argString==null";
            }
            ScriptEngine scriptEngine = ScriptEngine.getInstance();
            String string7 = string3;
            a$2 a$2 = new a$2(scriptEngine, string7);
            ScriptEngine$Action scriptEngine$Action = scriptEngine.addRunnableToQueue(a$2);
            scriptEngine$Action.tryToCatchCrash = true;
            boolean bl3 = false;
            if (string4.equalsIgnoreCase("functionNoTimeout")) {
                bl3 = true;
            }
            if ((string6 = scriptEngine$Action.waitForCompletionOrCrash(bl3)) == null) {
                String string8 = "ok\n";
                string8 = a$2.c == null ? string8 + "<NULL>" : string8 + "" + a$2.c;
                string8 = string8 + "\u0000";
                return string8;
            }
            String string9 = "crash\n";
            string9 = string9 + string6;
            string9 = string9 + "\u0000";
            return string9;
        }
        return "unknown command";
    }
}

