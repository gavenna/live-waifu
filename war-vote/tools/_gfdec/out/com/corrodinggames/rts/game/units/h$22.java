/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.a.a;
import com.corrodinggames.rts.game.units.a.x;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.h;
import com.corrodinggames.rts.gameFramework.l;

final class h$22
extends x {
    h$22(String string2) {
        super(string2);
    }

    @Override
    public String a() {
        return "Freeze high level AI logic (120secs)";
    }

    @Override
    public String b() {
        return "Freeze AI";
    }

    @Override
    public String d() {
        String string2 = "Freeze AI";
        l l2 = l.B();
        h h2 = com.corrodinggames.rts.game.units.h.L();
        if (h2 != null) {
            int n2 = -1;
            if (h2.bX instanceof a) {
                a a2 = (a)h2.bX;
                n2 = (int)a2.bG / 60;
            }
            if (n2 > 0) {
                string2 = string2 + "(" + n2 + ")";
            }
        }
        return string2;
    }

    @Override
    public boolean a(am am2, boolean bl2) {
        return am2.bX instanceof a;
    }
}

