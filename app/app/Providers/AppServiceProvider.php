<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\View;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // App de usuário único: compartilha o perfil atual com todas as views.
        View::composer('*', function ($view) {
            if (Schema::hasTable('users')) {
                $view->with('currentUser', User::with('preference')->first());
            }
        });
    }
}
