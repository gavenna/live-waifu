/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Color
 *  android.graphics.Paint
 *  android.graphics.Rect
 *  android.graphics.RectF
 */
package com.corrodinggames.rts.gameFramework.d;

import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.m.e;

public final class g {
    public String a;
    public int b = 25;
    public int c = 25;
    public int d = 1;
    public int e = 1;
    public int f = 26;
    public int g = 26;
    public int h = Integer.MAX_VALUE;
    public e i = null;
    public e j = null;
    public boolean k = false;
    static final Rect l = new Rect();
    static final RectF m = new RectF();

    public void a() {
        this.j = this.i.h();
        this.j.j();
        for (int i2 = 0; i2 < this.j.m(); ++i2) {
            for (int i3 = 0; i3 < this.j.l(); ++i3) {
                int n2 = this.j.a(i2, i3);
                this.j.a(i2, i3, Color.a((int)Color.a((int)n2), (int)0, (int)0, (int)0));
            }
        }
        this.j.p();
        this.j.s();
    }

    public void a(int n2, float f2, float f3, Paint paint) {
        Rect rect = l;
        RectF rectF = m;
        boolean bl2 = true;
        l l2 = com.corrodinggames.rts.gameFramework.l.B();
        int n3 = n2;
        int n4 = 0;
        if (n3 >= this.h) {
            n4 += n3 / this.h;
            n3 %= this.h;
        }
        int n5 = this.d + n3 * this.f;
        int n6 = this.e + n4 * this.g;
        l.a(n5, n6, n5 + this.b, n6 + this.c);
        rectF.a(f2, f3, f2 + (float)rect.b(), f3 + (float)rect.c());
        if (bl2) {
            rectF.a(-rectF.b() / 2.0f, -rectF.c() / 2.0f);
        }
        l2.bO.a(this.i, rect, rectF, paint);
    }
}

