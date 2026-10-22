import sys
import os

# Ensure we can import from 'app'
sys.path.append(os.path.join(os.path.dirname(__file__)))

from app.database import SessionLocal
from app import crud, schemas

def create_admin():
    db = SessionLocal()
    try:
        username = "admin"
        password = "abc123"
        
        # Check if exists
        existing_user = crud.get_user_by_username(db, username=username)
        if existing_user:
            print(f"User '{username}' already exists.")
            return

        # Create user
        # Note: email is optional in UserCreate and defaults to None
        user_in = schemas.UserCreate(username=username, password=password)
        created_user = crud.create_user(db, user_in)
        print(f"Successfully created user: {created_user.username} (ID: {created_user.id})")
        print(f"Password: {password}")

    except Exception as e:
        print(f"Error creating user: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()
