/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Bitmap$Config
 */
package com.corrodinggames.rts.gameFramework.b;

import android.graphics.Bitmap;
import com.corrodinggames.rts.gameFramework.b.ah$1;

class ai
implements Cloneable {
    public boolean a;
    public Bitmap.Config b;
    public int c;

    private ai() {
    }

    public int hashCode() {
        int n2 = this.b.hashCode() ^ this.c;
        return this.a ? n2 : -n2;
    }

    public boolean equals(Object object) {
        if (!(object instanceof ai)) {
            return false;
        }
        ai ai2 = (ai)object;
        return this.a == ai2.a && this.b == ai2.b && this.c == ai2.c;
    }

    public ai a() {
        try {
            return (ai)super.clone();
        }
        catch (CloneNotSupportedException cloneNotSupportedException) {
            throw new AssertionError((Object)cloneNotSupportedException);
        }
    }

    public /* synthetic */ Object clone() {
        return this.a();
    }

    /* synthetic */ ai(ah$1 ah$1) {
        this();
    }
}

