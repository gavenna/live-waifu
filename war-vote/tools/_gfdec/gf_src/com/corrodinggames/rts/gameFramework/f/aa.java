/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Paint$Cap
 */
package com.corrodinggames.rts.gameFramework.f;

import android.graphics.Paint;
import com.corrodinggames.rts.gameFramework.bn;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.m.ag;

public class aa {
    bn a;
    String b;
    int c;
    ag[] d;
    ag[] e;

    public ag a(int n2, boolean bl2) {
        int n3 = n2 / 25;
        if (n3 < 0) {
            n3 = 0;
        }
        if (n3 > 10) {
            n3 = 10;
        }
        if (bl2) {
            return this.e[n3];
        }
        return this.d[n3];
    }

    public aa(bn bn2, String string, int n2) {
        this.a = bn2;
        this.b = string;
        this.c = n2;
        this.d = new ag[11];
        this.e = new ag[11];
        for (int i2 = 0; i2 < 11; ++i2) {
            int n3 = i2 * 25;
            if (i2 == 10) {
                n3 = 255;
            }
            this.d[i2] = new ag();
            this.d[i2].a(2.0f);
            if (l.aZ) {
                this.d[i2].a(3.0f);
            }
            this.d[i2].a(Paint.Cap.b);
            this.d[i2].b(n2);
            this.d[i2].c(n3);
            this.e[i2] = new ag();
            this.e[i2].b(-13162713);
            this.e[i2].c(n3);
            this.e[i2].a(5.0f);
            this.e[i2].a(Paint.Cap.b);
        }
    }
}

