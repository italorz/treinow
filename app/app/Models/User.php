<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Retorna o usuário do app (single-user). Cria um padrão se não existir,
     * para que a aplicação nunca quebre por falta de seed.
     */
    public static function current(): self
    {
        return static::firstOrCreate(
            ['email' => 'lucas.silva@email.com'],
            ['name' => 'Lucas Silva', 'password' => bcrypt('senha1234')]
        );
    }

    public function preference(): HasOne
    {
        return $this->hasOne(UserPreference::class);
    }

    public function workoutDays(): HasMany
    {
        return $this->hasMany(WorkoutDay::class);
    }
}
