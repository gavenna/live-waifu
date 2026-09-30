/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.gameFramework;

import com.corrodinggames.rts.gameFramework.bh;
import java.util.ArrayList;

public strictfp class bi
extends ArrayList {
    public int a(int n2) {
        if (this.isEmpty()) {
            return 0;
        }
        int n3 = ((bh)this.get((int)0)).b;
        for (bh bh2 : this) {
            if (bh2.a > n2) {
                return n3;
            }
            n3 = bh2.b;
        }
        return n3;
    }
}

