/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units.a;

import com.corrodinggames.rts.gameFramework.j.as;
import com.corrodinggames.rts.gameFramework.j.k;
import java.util.HashMap;

public class c {
    private static final HashMap c = new HashMap();
    public static final c a = com.corrodinggames.rts.game.units.a.c.a("-1");
    String b;

    public static c a(String string2) {
        c c2 = (c)c.get(string2);
        if (c2 != null) {
            return c2;
        }
        c c3 = new c(string2);
        c.put(string2, c3);
        return c3;
    }

    public String a() {
        return this.b;
    }

    private c(String string2) {
        this.b = string2;
    }

    public static void a(as as2, c c2) {
        String string2 = null;
        if (c2 != null) {
            string2 = c2.b;
        }
        as2.b(string2);
    }

    public static c a(k k2) {
        String string2 = k2.j();
        if (string2 != null) {
            return com.corrodinggames.rts.game.units.a.c.a(string2);
        }
        return null;
    }

    public boolean equals(Object object) {
        return this == object;
    }

    public int hashCode() {
        return this.b.hashCode();
    }

    public String toString() {
        return "ActionId(" + this.b + ")";
    }

    public final boolean a(c c2) {
        return this == c2;
    }
}

