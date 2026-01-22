import argparse
import getpass
import sys

import storage


def main() -> int:
    parser = argparse.ArgumentParser(description="Admin utilities")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-user", help="Create a new user")
    create.add_argument("username")

    sub.add_parser("init-db", help="Initialize the database")

    args = parser.parse_args()

    if args.command == "init-db":
        storage.init_db()
        print("Database initialized.")
        return 0

    if args.command == "create-user":
        storage.init_db()
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm: ")
        if password != confirm:
            print("Passwords do not match.", file=sys.stderr)
            return 1
        storage.create_user(args.username, password)
        print("User created.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
