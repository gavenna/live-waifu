/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.game.b;

import android.graphics.RectF;
import com.corrodinggames.rts.game.b.b;
import com.corrodinggames.rts.game.b.f;
import com.corrodinggames.rts.game.b.i;
import com.corrodinggames.rts.game.b.j;
import com.corrodinggames.rts.game.n;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.as;
import com.corrodinggames.rts.game.units.custom.bb;
import com.corrodinggames.rts.game.units.custom.bc;
import com.corrodinggames.rts.gameFramework.j.ad;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.utility.m;
import com.corrodinggames.rts.gameFramework.utility.x;
import com.corrodinggames.rts.gameFramework.w;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.Locale;
import java.util.Properties;
import org.w3c.dom.Element;

public class a {
    public int a;
    public String b;
    public String c;
    public String d;
    public float e;
    public float f;
    public float g;
    public float h;
    public float i;
    private String p;
    public RectF j;
    public int k = -1;
    public j l;
    public int m = -1;
    public Properties n;
    public m o = new m();

    static float a(Element element, String string2) {
        String string3 = element.getAttribute(string2);
        try {
            return Float.parseFloat(string3);
        }
        catch (NumberFormatException numberFormatException) {
            throw new f("Invalid map: Error reading '" + string2 + "' invalid float: " + string3, numberFormatException);
        }
    }

    public a(Element element, b b2, i i2) {
        String string2;
        String string3;
        Object object;
        Element element2;
        Element element3;
        this.b = element.getAttribute("name");
        if (this.b != null) {
            this.c = this.b.trim().toLowerCase(Locale.ENGLISH);
        }
        this.d = element.getAttribute("type");
        this.e = Float.parseFloat(element.getAttribute("x"));
        this.f = Float.parseFloat(element.getAttribute("y"));
        if (element.hasAttribute("rotation")) {
            this.i = Float.parseFloat(element.getAttribute("rotation")) - 90.0f;
        }
        if (!element.getAttribute("width").equals("")) {
            this.g = com.corrodinggames.rts.game.b.a.a(element, "width");
        }
        if (!element.getAttribute("height").equals("")) {
            this.h = com.corrodinggames.rts.game.b.a.a(element, "height");
        }
        if ((element3 = (Element)element.getElementsByTagName("image").item(0)) != null) {
            this.p = element3.getAttribute("source");
        }
        if ((element2 = (Element)element.getElementsByTagName("properties").item(0)) != null && (object = element2.getElementsByTagName("property")) != null) {
            this.n = new Properties();
            for (int i3 = 0; i3 < object.getLength(); ++i3) {
                Element element4 = (Element)object.item(i3);
                string3 = element4.getAttribute("name");
                string2 = "";
                string2 = element4.hasAttribute("value") ? element4.getAttribute("value") : element4.getTextContent();
                this.n.setProperty(string3, string2);
            }
        }
        if (element.hasAttribute("gid")) {
            this.k = Integer.parseInt(element.getAttribute("gid"));
            this.l = b2.a(this.k);
            if (this.l != null) {
                this.l.p = true;
                this.l.r = true;
                this.m = this.k - this.l.l;
            } else {
                throw new RuntimeException("Unable to decode base 64 block, could not find tileId:" + this.k);
            }
        }
        object = this.n;
        this.j = new RectF(this.e, this.f, this.e + this.g, this.f + this.h);
        b2.a(this.j);
        this.e = this.j.a;
        this.f = this.j.b;
        this.g = this.j.b();
        this.h = this.j.c();
        float f2 = this.j.d();
        float f3 = this.j.e();
        string3 = element.getAttribute("type");
        if (!(string3 == null || string3.equals("") || string3.equals("unit") || string3.equals("comment") || i2.b.equalsIgnoreCase("triggers"))) {
            this.d("Triggers should be on triggers layer");
        }
        if (object != null) {
            string2 = ((Properties)object).getProperty("unit");
            String string4 = ((Properties)object).getProperty("customUnit");
            if (string2 != null || string4 != null) {
                am am2;
                String string5 = ((Properties)object).getProperty("team");
                n n2 = null;
                if (string5 == null) {
                    throw new f("Unit object team missing for:" + (string2 != null ? string2 : string4));
                }
                if ("none".equalsIgnoreCase(string5)) {
                    n2 = com.corrodinggames.rts.game.n.k(-1);
                } else {
                    int n3;
                    try {
                        n3 = Integer.valueOf(string5);
                    }
                    catch (NumberFormatException numberFormatException) {
                        throw new f("Unit object team invalid: " + numberFormatException.getMessage(), numberFormatException);
                    }
                    n2 = com.corrodinggames.rts.game.n.k(n3);
                    if (n2 == null) {
                        com.corrodinggames.rts.gameFramework.l.b("map", "Unit object without team:" + string2 + " (skipping unit)");
                        return;
                    }
                    if (n2.b()) {
                        com.corrodinggames.rts.gameFramework.l.b("map", "Unit team is marked as spectator:" + string2 + " (skipping unit)");
                        return;
                    }
                }
                if (string4 != null) {
                    com.corrodinggames.rts.game.units.custom.l l2 = com.corrodinggames.rts.game.units.custom.l.n(string4);
                    if (l2 == null) {
                        throw new f("Could not find custom unit of:" + string4 + " at x:" + this.e + ", y:" + this.f);
                    }
                    as as2 = com.corrodinggames.rts.game.units.custom.l.c(l2);
                    if (as2 != null) {
                        if (as2 instanceof com.corrodinggames.rts.game.units.custom.l) {
                            l2 = (com.corrodinggames.rts.game.units.custom.l)as2;
                        } else {
                            com.corrodinggames.rts.gameFramework.l.b("replacement not a custom unit:" + as2.i());
                        }
                    }
                    if ((am2 = com.corrodinggames.rts.game.units.custom.l.a(false, l2)) == null) {
                        throw new RuntimeException("Metadata unit is null for:" + string4);
                    }
                } else {
                    am2 = null;
                    as as3 = ar.a(string2);
                    if (as3 != null) {
                        am2 = as3.a();
                    } else {
                        throw new f("Could not find unit type of:" + string2 + " at x:" + this.e + ", y:" + this.f);
                    }
                }
                am2.eo = f2;
                am2.ep = f3;
                if (!am2.bI()) {
                    am2.h(this.i);
                }
                if (n2 == null) {
                    throw new f("team is null:" + string2);
                }
                am2.b(n2);
                if (((Properties)object).getProperty("type") != null) {
                    am2.a_(((Properties)object).getProperty("type"));
                }
                if (((Properties)object).getProperty("randomRotate") != null && !am2.bI()) {
                    am2.h(com.corrodinggames.rts.gameFramework.f.a(am2, -180, 180));
                }
                am2.bO = "builder".equalsIgnoreCase(string2) || "builder".equalsIgnoreCase(string4);
                am2.bP = "commandCenter".equalsIgnoreCase(string2) || "commandCenter".equalsIgnoreCase(string4);
                am2.bM = true;
                am2.n();
                com.corrodinggames.rts.game.n.c(am2);
                w.dL();
            }
        }
    }

    public boolean a(am am2) {
        return this.j.b((int)am2.eo, (int)am2.ep);
    }

    public void a(String string2) {
        if (!this.o.contains(string2)) {
            this.o.add(string2);
        }
    }

    public String[] a() {
        if (this.n == null) {
            return x.h;
        }
        m m2 = new m();
        Enumeration<?> enumeration = this.n.propertyNames();
        while (enumeration.hasMoreElements()) {
            String string2 = (String)enumeration.nextElement();
            if (this.o.contains(string2)) continue;
            m2.add(string2);
        }
        return (String[])m2.toArray(x.h);
    }

    public String b(String string2) {
        this.a(string2);
        if (this.n == null) {
            return null;
        }
        return this.n.getProperty(string2);
    }

    public String a(String string2, String string3) {
        this.a(string2);
        if (this.n == null) {
            return null;
        }
        return this.n.getProperty(string2, string3);
    }

    public Integer c(String string2) {
        String string3 = this.a(string2, (String)null);
        if (string3 == null) {
            return null;
        }
        try {
            return Integer.parseInt(string3);
        }
        catch (NumberFormatException numberFormatException) {
            throw new f(string2 + ": Unexpected integer value:'" + string3 + "'");
        }
    }

    public bb a(String string2, bb bb2) {
        String string3;
        Object object2;
        String string4 = this.a(string2, (String)null);
        if (string4 == null) {
            return bb2;
        }
        ArrayList<bc> arrayList = new ArrayList<bc>();
        bc bc2 = new bc(null, string4);
        arrayList.add(bc2);
        String string5 = string2 + "_";
        m m2 = new m();
        for (Object object2 : this.n.keySet()) {
            if (object2 instanceof String) {
                string3 = (String)object2;
                if (!string3.startsWith(string5)) continue;
                m2.add(string3);
                continue;
            }
            com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty: Non string:" + object2);
        }
        for (Object object2 : m2) {
            string3 = ((String)object2).substring(string5.length());
            string3 = string3.toLowerCase(Locale.ROOT);
            com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty checking: " + (String)object2);
            if (string3.length() > 4) continue;
            String string6 = this.b((String)object2);
            com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty got: " + string6);
            com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty code: " + string3);
            bc bc3 = new bc(string3, string6);
            arrayList.add(bc3);
        }
        bc[] bcArray = arrayList.toArray(new bc[0]);
        object2 = new bb(bcArray);
        ((bb)object2).b();
        com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty final: " + ((bb)object2).b());
        com.corrodinggames.rts.gameFramework.l.b("createLocaleStringFromProperty locate: " + com.corrodinggames.rts.gameFramework.h.a.c());
        return object2;
    }

    public void d(String string2) {
        ad.g("(Map trigger: " + this.b + ", type:" + this.d + "): " + string2);
    }

    public String b() {
        return "(Map trigger: " + this.b + ", type:" + this.d + ")";
    }
}

