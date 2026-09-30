/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import com.corrodinggames.rts.game.units.a.x;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.h;
import com.corrodinggames.rts.game.units.h$3$1;
import com.corrodinggames.rts.game.units.h$3$2;
import com.corrodinggames.rts.game.units.h$3$3;
import com.corrodinggames.rts.gameFramework.f.a.f;
import com.corrodinggames.rts.gameFramework.h.a;
import com.corrodinggames.rts.gameFramework.l;

final class h$3
extends x {
    h$3(String string2) {
        super(string2);
    }

    @Override
    public String a() {
        return "Start playback of last a replay";
    }

    @Override
    public String b() {
        return "Start Playback";
    }

    @Override
    public String d() {
        String string2 = "Start Playback";
        l l2 = l.B();
        boolean bl2 = l2.cb.j();
        string2 = !bl2 ? "Start Playback" : "Stop Playback";
        return string2;
    }

    @Override
    public boolean a(am am2, boolean bl2) {
        l l2 = l.B();
        boolean bl3 = l2.cb.k();
        h h2 = com.corrodinggames.rts.game.units.h.L();
        if (h2 == null) {
            return false;
        }
        return h2.r != null && !bl3;
    }

    @Override
    public boolean b(am am2) {
        h h2 = com.corrodinggames.rts.game.units.h.L();
        if (h2 == null) {
            return false;
        }
        return h2.r != null;
    }

    @Override
    public boolean a(am am2) {
        l l2 = l.B();
        boolean bl2 = l2.cb.j();
        return bl2;
    }

    @Override
    public boolean c(am am2, boolean bl2) {
        l l2 = l.B();
        String string2 = com.corrodinggames.rts.game.units.h.L().r;
        if (string2 == null) {
            l2.i("No last replay found");
            return false;
        }
        boolean bl3 = l2.cb.j();
        if (!bl3) {
            h$3$1 h$3$1 = new h$3$1(this, string2);
            f f2 = f.a("Start playback of last recording?", true);
            f2.a(a.a("menus.common.ok", new Object[0]), new h$3$2(this, f2, l2, h$3$1));
            l2.bS.a(f2);
        } else {
            h$3$3 h$3$3 = new h$3$3(this);
            l2.a(h$3$3);
        }
        return false;
    }
}

