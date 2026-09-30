/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.units.a.x;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.h;

final class h$5
extends x {
    h$5(String string2) {
        super(string2);
    }

    @Override
    public String a() {
        return "Freeze full high level logic for all AI forever";
    }

    @Override
    public String b() {
        return "Freeze AI";
    }

    @Override
    public String d() {
        boolean bl2;
        String string2 = "Freeze AI";
        h h2 = com.corrodinggames.rts.game.units.h.L();
        if (h2 != null && (bl2 = h2.c)) {
            string2 = "Unfreeze AIs";
        }
        return string2;
    }

    @Override
    public boolean a(am am2, boolean bl2) {
        return true;
    }
}

