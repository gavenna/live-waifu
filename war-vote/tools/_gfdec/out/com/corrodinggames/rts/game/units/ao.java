/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.units;

import java.util.Locale;

public strictfp enum ao {
    a,
    b,
    c,
    d,
    e,
    f,
    g,
    h;


    public static ao a(String string2, String string3) {
        try {
            return ao.valueOf(string2.toUpperCase(Locale.ROOT));
        }
        catch (IllegalArgumentException illegalArgumentException) {
            String string4 = "";
            for (ao ao2 : ao.values()) {
                string4 = string4 + ", " + ao2.toString();
            }
            throw new IllegalArgumentException("Unknown movement type:'" + string2 + "' possible type:" + string4 + " on key:" + string3);
        }
    }
}

