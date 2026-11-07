package com.cgtcalculator.platform.account;

import java.nio.charset.StandardCharsets;

import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

/** The password rules, the same everywhere a password is set. */
public final class Passwords {

    public static final int MIN_LENGTH = 8;
    /** bcrypt uses only the first 72 bytes of a password, and refuses longer ones. */
    public static final int MAX_BYTES = 72;

    private Passwords() {
    }

    /** Whether bcrypt can check the password; a longer one can't be anyone's. */
    public static boolean fits(String password) {
        return password.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES;
    }

    /** @param mismatch the message when the confirmation differs */
    public static void validate(String password, String confirmation, String mismatch) {
        if (password == null || password.length() < MIN_LENGTH) {
            throw new ValidationException("password", "The password must be at least " + MIN_LENGTH + " characters.");
        }
        if (!fits(password)) {
            throw new ValidationException("password", "The password must be at most " + MAX_BYTES
                    + " bytes (72 letters or digits, fewer with accents or emoji).");
        }
        if (!password.equals(confirmation)) {
            throw new ValidationException("password", mismatch);
        }
    }
}
