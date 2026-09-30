/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.librocket.scripts;

import com.corrodinggames.rts.gameFramework.f;

public class Root$TableCell {
    public String text;
    public String classes;
    public String librocketOnClick;
    public Integer color;

    public void setLibrocketOnClick(String string2) {
        this.librocketOnClick = string2;
    }

    public Root$TableCell(String string2) {
        this.text = string2;
    }

    public void addClass(String string2) {
        this.classes = this.classes != null ? this.classes + " " + string2 : string2;
    }

    public boolean same(Root$TableCell root$TableCell, boolean bl2) {
        if (!(f.d(this.classes, root$TableCell.classes) && f.d(this.librocketOnClick, root$TableCell.librocketOnClick) && f.a(this.color, root$TableCell.color))) {
            return false;
        }
        return bl2 || f.d(this.text, root$TableCell.text);
    }
}

