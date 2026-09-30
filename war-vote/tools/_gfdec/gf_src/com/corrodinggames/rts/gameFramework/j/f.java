/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.corrodinggames.rts.game.units.am
 */
package com.corrodinggames.rts.gameFramework.j;

import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.gameFramework.j.as;

public class f
extends as {
    public String a = "";

    @Override
    public strictfp void a(int n2) {
        this.a = this.a + "|" + n2;
        super.a(n2);
    }

    @Override
    public strictfp void a(float f2) {
        this.a = this.a + "|" + f2;
        super.a(f2);
    }

    @Override
    public strictfp void a(short s2) {
        this.a = this.a + "|" + s2;
        super.a(s2);
    }

    @Override
    public strictfp void a(boolean bl2) {
        this.a = this.a + "|" + bl2;
        super.a(bl2);
    }

    @Override
    public strictfp void a(String string, boolean bl2) {
        this.a = this.a + "<" + string + ">";
        super.a(string, bl2);
    }

    @Override
    public strictfp void a(String string) {
        this.a = this.a + "</" + string + ">";
        super.a(string);
    }

    @Override
    public strictfp void a(am am2) {
        this.a = this.a + "|u:" + am2;
        super.a(am2);
    }
}

