/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Paint
 */
package com.corrodinggames.rts.gameFramework.m;

import android.graphics.Paint;
import com.corrodinggames.rts.gameFramework.m.ae;
import com.corrodinggames.rts.gameFramework.m.e;
import com.corrodinggames.rts.gameFramework.m.h;

public class i
extends ae {
    int a = -99;
    boolean b;

    public i(String string, boolean bl2) {
        super(string);
    }

    @Override
    public boolean a() {
        return this.b;
    }

    @Override
    public boolean b() {
        boolean bl2 = false;
        int n2 = -16711936;
        if (n2 != this.a) {
            this.a("teamColor", n2);
            bl2 = true;
            this.a = n2;
        }
        return bl2;
    }

    @Override
    public boolean a(Paint paint, e e2) {
        boolean bl2 = false;
        if (e2 instanceof h) {
            h h2 = (h)e2;
            if (h2.D != this.a) {
                this.a("teamColor", h2.D);
                bl2 = true;
                this.a = h2.D;
            }
        }
        super.a(paint, e2);
        return bl2;
    }

    @Override
    public void c() {
        super.c();
    }
}

