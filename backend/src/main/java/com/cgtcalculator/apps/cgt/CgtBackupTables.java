package com.cgtcalculator.apps.cgt;

import java.util.List;

import org.springframework.stereotype.Component;

import com.cgtcalculator.platform.backup.BackupTables;

/** The CGT calculator's data in the backup: everyone's purchases and sales and settings (not the exchange rates). */
@Component
public class CgtBackupTables implements BackupTables {

    @Override
    public List<Table> tables() {
        return List.of(new Table("cgt_settings", "user_id", false));
    }
}
