/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.b.a;

final class ar$5
extends ar {
    @Override
    public boolean C() {
        return true;
    }

    @Override
    public am a(boolean bl2) {
        return new a(bl2);
    }

    @Override
    public void b() {
        com.corrodinggames.rts.game.units.b.a.f();
    }

    @Override
    public int c() {
        return 600;
    }

    @Override
    public float D() {
        return 0.002f;
    }
}

