/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.corrodinggames.rts.game.units.ar
 *  com.corrodinggames.rts.game.units.y
 */
package com.corrodinggames.rts.gameFramework.f;

import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.y;
import com.corrodinggames.rts.gameFramework.f.al;

final class al$4
extends al {
    al$4() {
    }

    @Override
    public boolean a(y y2) {
        return y2.r() == ar.J && y2.V() < 3 && y2.cN == null;
    }
}

