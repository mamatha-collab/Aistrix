from scripts.run_local import local_environment


def test_staging_secrets_do_not_fall_back_to_default_or_inherited_values():
    env = local_environment(
        {'SUPABASE_URL': 'https://staging.example.invalid', 'SUPABASE_ANON_KEY': 'staging'},
        {'SUPABASE_URL': 'https://production.example.invalid', 'OPENAI_API_KEY': 'production'},
        {'OPENAI_API_KEY': 'inherited', 'PATH': 'preserved'},
    )
    assert env['SUPABASE_URL'] == 'https://staging.example.invalid'
    assert env['OPENAI_API_KEY'] == ''
    assert env['PATH'] == 'preserved'


def test_local_origins_are_explicit_and_do_not_replace_existing_origins():
    env = local_environment({'ALLOWED_ORIGINS': 'http://localhost:5173,http://localhost:3000'}, {}, {})
    assert env['ALLOWED_ORIGINS'].split(',') == [
        'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000',
    ]
    assert env['FRONTEND_URL'] == 'http://localhost:3000'
    assert env['SCHEDULER_INTERVAL_SECONDS'] == '0'
