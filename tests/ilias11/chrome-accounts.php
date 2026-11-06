<?php

declare(strict_types=1);

/**
 * Synthetic accounts for native Chrome acceptance in a disposable ILIAS client.
 * Creates no answers. Passwords are random and kept only in the private state file.
 */
require __DIR__ . '/bootstrap.php';

$stateFile = getenv('ILIAS_CHROME_STATE') ?: sys_get_temp_dir() . '/asssql-chrome-accounts.json';
if (is_file($stateFile)) {
    $state = json_decode(file_get_contents($stateFile), true, flags: JSON_THROW_ON_ERROR);
} else {
    $category = new ilObjCategory();
    $category->setTitle('SQL Chrome acceptance — lecturer and student');
    $category->setDescription('Disposable local acceptance data. Original study question content is never committed.');
    $category->create();
    $category->createReference();
    $category->putInTree(1);
    $category->setPermissions(1);

    $admin = $DIC->rbac()->admin();
    $review = $DIC->rbac()->review();
    $role = new ilObjRole();
    $role->setTitle('SQL Chrome lecturer — local pool and test author');
    $role->setDescription('May create question pools and tests only in the disposable acceptance category.');
    $role->create();
    $admin->assignRoleToFolder($role->getId(), $category->getRefId(), 'y');
    $categoryOperations = ilRbacReview::_getOperationIdsByName(['visible', 'read', 'create_qpl', 'create_tst']);
    $admin->grantPermission($role->getId(), $categoryOperations, $category->getRefId());
    $admin->setRolePermission($role->getId(), 'cat', $categoryOperations, $category->getRefId());
    foreach (['qpl', 'tst'] as $type) {
        $admin->setRolePermission($role->getId(), $type, $review->getOperationsOnTypeString($type), $category->getRefId());
    }

    $state = ['category_ref_id' => $category->getRefId(), 'category_id' => $category->getId(),
        'teacher_role_id' => $role->getId(), 'base_url' => ILIAS_HTTP_PATH];
    foreach (['teacher' => 'Lecturer', 'student' => 'Student'] as $key => $lastname) {
        $user = new ilObjUser();
        $user->setLogin('sql.chrome.' . $key);
        $user->setFirstname('SQL acceptance');
        $user->setLastname($lastname);
        $user->setEmail('sql-chrome-' . $key . '@example.invalid');
        $password = 'Sql-' . bin2hex(random_bytes(12)) . '!';
        $user->setPasswd($password);
        $user->setLastPasswordChangeToNow();
        $user->setAuthMode('default');
        $user->setActive(true, $DIC->user()->getId());
        $user->setTimeLimitUnlimited(true);
        $user->setProfileIncomplete(false);
        $user->setPref('language', 'en');
        $user->create();
        $user->saveAsNew();
        $user->setLastPasswordChangeToNow();
        $user->setPasswordPolicyResetStatus(false);
        $user->update();
        // Standard global User role; neither account is a system administrator.
        $admin->assignUser(4, $user->getId());
        if ($key === 'teacher') {
            $admin->assignUser($role->getId(), $user->getId());
        }
        if ($review->isAssigned($user->getId(), SYSTEM_ROLE_ID)) {
            throw new RuntimeException('Acceptance accounts must not be system administrators.');
        }
        $state[$key] = ['id' => $user->getId(), 'login' => $user->getLogin(), 'password' => $password];
    }
    file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
    chmod($stateFile, 0600);
}

if (($argv[1] ?? '') === 'prepare') {
    $prepareUsers = isset($argv[2]) ? [$argv[2]] : ['teacher', 'student'];
    foreach ($prepareUsers as $key) {
        if (!in_array($key, ['teacher', 'student'], true)) throw new InvalidArgumentException('Unknown acceptance account.');
        $user = new ilObjUser($state[$key]['id']);
        $user->setLastPasswordChangeToNow();
        $user->setPasswordPolicyResetStatus(false);
        $user->update();
    }
}

if (($argv[1] ?? '') === 'pools') {
    $db = $DIC->database();
    $rows = $db->queryF(
        'SELECT d.obj_id, d.owner, r.ref_id FROM object_data d JOIN object_reference r ON r.obj_id = d.obj_id JOIN tree t ON t.child = r.ref_id WHERE t.parent = %s AND d.type = %s ORDER BY r.ref_id',
        ['integer', 'text'], [$state['category_ref_id'], 'qpl']
    );
    $pools = [];
    while ($row = $db->fetchAssoc($rows)) {
        $questions = $db->queryF('SELECT question_id, owner FROM qpl_questions WHERE obj_fi = %s ORDER BY question_id', ['integer'], [$row['obj_id']]);
        $ids = [];
        $owners = [];
        while ($question = $db->fetchAssoc($questions)) {
            $ids[] = (int) $question['question_id'];
            $owners[(int) $question['owner']] = true;
        }
        $ownerIds = array_keys($owners);
        sort($ownerIds);
        $pools[] = ['pool_id' => (int) $row['obj_id'], 'pool_ref_id' => (int) $row['ref_id'], 'owner' => (int) $row['owner'], 'question_ids' => $ids, 'question_owner_ids' => $ownerIds, 'count' => count($ids)];
    }
    echo 'CHROME_POOLS_JSON=' . json_encode(['pools' => $pools], JSON_THROW_ON_ERROR) . "\n";
    exit;
}

$summary = $state;
foreach (['teacher', 'student'] as $key) {
    unset($summary[$key]['password']);
    $summary[$key]['roles'] = $DIC->rbac()->review()->assignedRoles($state[$key]['id']);
    $summary[$key]['last_password_change'] = (new ilObjUser($state[$key]['id']))->getLastPasswordChangeTS();
    $summary[$key]['is_system_admin'] = $DIC->rbac()->review()->isAssigned($state[$key]['id'], SYSTEM_ROLE_ID);
}
$summary['state_file'] = $stateFile;
echo json_encode($summary, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
