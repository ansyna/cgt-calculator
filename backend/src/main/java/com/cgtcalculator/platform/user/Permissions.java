package com.cgtcalculator.platform.user;

import java.util.List;

/** Permission names (same as the Laravel PermissionsTableSeeder). */
public final class Permissions {

    public static final String ROLE_LIST = "role-list";
    public static final String ROLE_CREATE = "role-create";
    public static final String ROLE_EDIT = "role-edit";
    public static final String ROLE_DELETE = "role-delete";
    public static final String USER_LIST = "user-list";
    public static final String USER_CREATE = "user-create";
    public static final String USER_EDIT = "user-edit";
    public static final String USER_DELETE = "user-delete";
    public static final String VIEW_INVESTING_TOOLS = "view-investing-tools";

    public static final List<String> ALL = List.of(
            ROLE_LIST, ROLE_CREATE, ROLE_EDIT, ROLE_DELETE,
            USER_LIST, USER_CREATE, USER_EDIT, USER_DELETE,
            VIEW_INVESTING_TOOLS);

    private Permissions() {
    }
}
