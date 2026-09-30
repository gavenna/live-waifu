/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.RectF
 */
package com.corrodinggames.rts.gameFramework.b;

import android.graphics.RectF;
import com.corrodinggames.rts.gameFramework.b.b;

public class ag {
    public static void a(b b2, RectF rectF) {
        boolean bl2 = false;
        boolean bl3 = false;
        int n2 = b2.b();
        int n3 = b2.c();
        if (b2.f()) {
            bl2 = true;
            bl3 = true;
            --n2;
            --n3;
        }
        rectF.a((float)bl2, (float)bl3, (float)n2, (float)n3);
    }
}

