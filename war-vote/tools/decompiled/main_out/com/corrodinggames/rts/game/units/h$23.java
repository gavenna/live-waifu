/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.units.a.x;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.h;

final class h$23
extends x {
    h$23(String string2) {
        super(string2);
    }

    @Override
    public String a() {
        return "Change selected player's alliance (players with the same letter are allied)";
    }

    @Override
    public String b() {
        return "Ally:";
    }

    @Override
    public String d() {
        String string2 = "Ally";
        h h2 = com.corrodinggames.rts.game.units.h.L();
        if (h2 != null) {
            string2 = "Ally: " + h2.bX.h();
        }
        return string2;
    }

    @Override
    public boolean a(am am2, boolean bl2) {
        return true;
    }
}

