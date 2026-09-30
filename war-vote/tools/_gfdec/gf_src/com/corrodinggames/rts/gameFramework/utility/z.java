/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Paint$Style
 */
package com.corrodinggames.rts.gameFramework.utility;

import android.graphics.Paint;
import com.corrodinggames.rts.gameFramework.m.ag;

public strictfp final class z {
    public int a;
    public Paint.Style b;
    public ag c;

    public z(int n2, Paint.Style style) {
        ag ag2 = new ag();
        ag2.b(n2);
        ag2.a(style);
        this.c = ag2;
        this.b = style;
        this.a = n2;
    }
}

