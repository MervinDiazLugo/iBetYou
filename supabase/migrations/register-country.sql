                                                -- Add country to user profiles
                                                ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;

                                                -- Add country to deposit accounts
                                                -- NULL = global (shown to all users regardless of country, e.g. Binance)
                                                -- specific value = shown only to users from that country
                                                ALTER TABLE deposit_accounts ADD COLUMN IF NOT EXISTS country TEXT;
