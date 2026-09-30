/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Bitmap
 */
package com.corrodinggames.rts.gameFramework.b;

import android.graphics.Bitmap;
import com.corrodinggames.rts.gameFramework.b.ah;

public class e
extends ah {
    protected Bitmap l;

    public e(Bitmap bitmap) {
        this(bitmap, false);
    }

    public e(Bitmap bitmap, boolean bl2) {
        super(bl2);
        this.l = bitmap;
        this.m = this.k();
        int n2 = this.m.b() + 0;
        int n3 = this.m.c() + 0;
        this.a(n2, n3);
    }

    @Override
    protected void a(Bitmap bitmap) {
    }

    @Override
    protected Bitmap k() {
        return this.l;
    }
}

