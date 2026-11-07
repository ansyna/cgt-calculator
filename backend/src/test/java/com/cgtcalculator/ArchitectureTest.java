package com.cgtcalculator;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * The backend's shape: com.cgtcalculator.platform is what every app shares (accounts, users, security, backup,
 * monitoring, shared web pieces); each app lives in com.cgtcalculator.apps.&lt;app&gt; and plugs in through Spring
 * (beans such as BackupTables, its own controllers and error handling).
 */
@AnalyzeClasses(packages = "com.cgtcalculator", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    @ArchTest
    static final ArchRule platformKnowsNoApp = noClasses().that().resideInAPackage("com.cgtcalculator.platform..")
            .should().dependOnClassesThat().resideInAPackage("com.cgtcalculator.apps..")
            .because("apps plug into the platform, not the other way round");

    @ArchTest
    static final ArchRule appsDoNotUseEachOther = slices().matching("com.cgtcalculator.apps.(*)..")
            .should().notDependOnEachOther()
            .because("what apps share belongs in the platform");

    @ArchTest
    static final ArchRule everythingIsPlatformOrApp = classes().that().resideOutsideOfPackages("com.cgtcalculator.platform..",
                    "com.cgtcalculator.apps..")
            .should().haveSimpleName("CgtCalculatorApplication")
            .because("a class belongs to the platform or to an app (only the application class sits at the top)");
}
