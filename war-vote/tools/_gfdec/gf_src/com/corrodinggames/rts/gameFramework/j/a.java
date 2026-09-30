/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.text.Html
 *  android.text.Spanned
 */
package com.corrodinggames.rts.gameFramework.j;

import android.text.Html;
import android.text.Spanned;
import com.corrodinggames.rts.gameFramework.f;
import com.corrodinggames.rts.gameFramework.j.b;
import com.corrodinggames.rts.gameFramework.j.c;
import java.util.concurrent.ConcurrentLinkedQueue;

public class a {
    private ConcurrentLinkedQueue a = new ConcurrentLinkedQueue();

    public String a(String string) {
        return f.i(string);
    }

    public void a(int n2, String string, String string2, c c2) {
        string2 = string2.trim();
        b b2 = new b(this, n2, string, string2, c2);
        this.a.add(b2);
        if (this.a.size() > 45) {
            this.a.poll();
        }
    }

    public int a(c c2, int n2) {
        if (c2 == null) {
            return 0;
        }
        int n3 = c2.c;
        int n4 = 0;
        for (b b2 : this.a) {
            if (b2.d != n3 || f.a(b2.e, System.nanoTime()) >= (long)n2 || b2.c.startsWith("-i ") || b2.c.startsWith("-qc ")) continue;
            ++n4;
            if (b2.c == null) continue;
            if (f.a(b2.c, '\n') >= 3) {
                n4 += 2;
            }
            if (f.a(b2.c, '\n') >= 6) {
                n4 += 2;
            }
            if (f.a(b2.c, '\n') < 9) continue;
            n4 += 2;
        }
        return n4;
    }

    public String a() {
        String string = "";
        for (b b2 : this.a) {
            string = string + b2.a() + "\n";
        }
        return string;
    }

    public ConcurrentLinkedQueue b() {
        return this.a;
    }

    public String a(boolean bl2) {
        String string = "";
        if (!bl2) {
            for (b b2 : this.a) {
                string = string + b2.b() + "<br/>\n";
            }
        } else {
            for (b b3 : this.a) {
                string = b3.b() + "<br/>\n" + string;
            }
        }
        return "<pre>" + string + "</pre>";
    }

    public Spanned b(boolean bl2) {
        return Html.fromHtml((String)this.a(bl2));
    }

    public void c() {
        this.a.clear();
    }
}

