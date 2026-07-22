package com.fraudcell.identity.security;

import java.util.regex.Pattern;

public final class PasswordPolicy {
    private static final Pattern UPPER = Pattern.compile("[A-ZÇĞİÖŞÜ]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private static final Pattern SPECIAL = Pattern.compile("[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]");

    private PasswordPolicy() {}

    public static boolean valid(String password) {
        return password != null && password.length() >= 8
                && UPPER.matcher(password).find()
                && DIGIT.matcher(password).find()
                && SPECIAL.matcher(password).find();
    }
}
