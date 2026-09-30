/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.h.e;

final class ar$31
extends ar {
    @Override
    public boolean C() {
        return false;
    }

    @Override
    public am a(boolean bl2) {
        return new e(bl2);
    }

    @Override
    public void b() {
        com.corrodinggames.rts.game.units.h.e.b();
    }

    @Override
    public int c() {
        return 800;
    }

    @Override
    public float D() {
        return 0.001f;
    }
}

