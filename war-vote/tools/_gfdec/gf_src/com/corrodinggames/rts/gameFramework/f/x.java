/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.corrodinggames.rts.game.n
 *  com.corrodinggames.rts.game.units.ar
 *  com.corrodinggames.rts.game.units.as
 *  com.corrodinggames.rts.game.units.custom.e.f
 *  com.corrodinggames.rts.game.units.x
 */
package com.corrodinggames.rts.gameFramework.f;

import com.corrodinggames.rts.game.n;
import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.as;
import com.corrodinggames.rts.game.units.custom.e.f;
import com.corrodinggames.rts.gameFramework.l;

public class x
extends com.corrodinggames.rts.game.units.x {
    f a = new f();

    public ar b() {
        return ar.R;
    }

    public x() {
        super(true);
        this.bX = n.i;
    }

    public void a(float f2) {
        super.a(f2);
        l.a("PlaceholderUnit was updated");
        this.ci();
    }

    public strictfp boolean t() {
        return true;
    }

    public strictfp boolean u() {
        return true;
    }

    public f df() {
        return this.a;
    }

    public void a(f f2) {
        this.a = f2;
    }

    public /* synthetic */ as r() {
        return this.b();
    }
}

