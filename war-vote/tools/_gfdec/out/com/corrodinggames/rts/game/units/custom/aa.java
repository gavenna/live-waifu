/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units.custom;

import com.corrodinggames.rts.gameFramework.j;
import com.corrodinggames.rts.gameFramework.l;

strictfp class aa {
    public long a;
    public String b;

    public aa(String string2) {
        this.b = string2;
        this.a = this.a(true);
    }

    public long a(boolean bl2) {
        if (l.au()) {
            return 0L;
        }
        long l2 = j.a(this.b, bl2);
        if (bl2 && l2 == 0L) {
            l.e("Failed to watch: " + this.b);
        }
        return l2;
    }
}

