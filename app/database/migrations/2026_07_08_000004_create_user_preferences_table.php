<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('objetivo')->nullable();       // hipertrofia | forca | emagrecimento | condicionamento
            $table->string('nivel')->nullable();          // iniciante | intermediario | avancado
            $table->unsignedTinyInteger('dias_por_semana')->nullable();
            $table->string('duracao_min')->nullable();    // faixa ex.: "60-75"
            $table->string('sexo')->nullable();
            $table->unsignedTinyInteger('idade')->nullable();
            $table->decimal('peso', 5, 2)->nullable();
            $table->unsignedSmallInteger('altura')->nullable();
            $table->string('local')->default('academia'); // academia | casa
            $table->json('equipamentos')->nullable();
            $table->json('musculos_prioritarios')->nullable();
            $table->json('restricoes')->nullable();
            $table->boolean('evitar_unilaterais')->default(false);
            $table->boolean('treinos_intensos')->default(false);
            $table->string('avatar_path')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_preferences');
    }
};
