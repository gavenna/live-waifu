/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.RectF
 */
package com.corrodinggames.rts.gameFramework.b;

import android.graphics.RectF;
import com.corrodinggames.rts.gameFramework.b.ad;
import com.corrodinggames.rts.gameFramework.b.b;
import com.corrodinggames.rts.gameFramework.b.k;
import com.corrodinggames.rts.gameFramework.l;

public class ae
extends b {
    ad l;
    public float m;
    public float n;
    public int o;
    public int p;

    @Override
    protected boolean c(k k2) {
        return false;
    }

    @Override
    protected int g() {
        return 3553;
    }

    @Override
    public void b(int n2) {
        this.l.b(n2);
    }

    @Override
    public int h() {
        return this.l.h();
    }

    @Override
    public void a(RectF rectF) {
        float f2 = this.g;
        float f3 = this.h;
        rectF.a = rectF.a * f2 + this.m;
        rectF.c = rectF.c * f2 + this.m;
        rectF.b = rectF.b * f3 + this.n;
        rectF.d = rectF.d * f3 + this.n;
    }

    @Override
    public void a(RectF rectF, RectF rectF2) {
        ae ae2 = this;
    }

    @Override
    public void b(k k2) {
        com.corrodinggames.rts.gameFramework.l.e("SubTexture prepare TODO");
    }
}

