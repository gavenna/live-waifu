/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units.custom;

class a
implements Comparable {
    public float a;
    public float b;
    public float c;
    public float d;

    public a(float f2, float f3) {
        this.a = f2;
        this.b = f3;
    }

    public int a(a a2) {
        if (this.a == a2.a) {
            return 0;
        }
        return this.a > a2.a ? 1 : -1;
    }

    public /* synthetic */ int compareTo(Object object) {
        return this.a((a)object);
    }
}

