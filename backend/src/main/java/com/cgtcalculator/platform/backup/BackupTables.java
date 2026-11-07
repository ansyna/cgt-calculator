package com.cgtcalculator.platform.backup;

import java.util.List;

/**
 * An app's tables in the monthly backup (its own data, not caches), after the shared ones (users, roles, links,
 * activity). A table's rows are restored in this order, so parents come before the rows that refer to them.
 */
public interface BackupTables {

    /**
     * A table and how its rows are ordered.
     *
     * @param identity whether its id column is numbered by the database (the numbering continues after a restore)
     */
    record Table(String name, String orderBy, boolean identity) {
    }

    List<Table> tables();
}
